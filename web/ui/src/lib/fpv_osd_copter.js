// Copter HUD for the web viewer: the multirotor counterpart of fpv_osd.js.
//
// Same drawing model: one canvas over the video, laid out in a fixed 1280x720
// reference space and letterbox-scaled to the real backing store. Same
// interface as FpvOsd (attach / resize / configure / clear / render), so the
// page swaps one for the other. It takes the same `flight` object.
//
// Look: a sci-fi glass cockpit. Translucent corner-cut panels with bracket
// corners hold the readouts (status, battery, altitude, vertical speed, GPS,
// RC link, ground speed, home radar); the middle of the picture stays clear
// apart from the attitude ladder and the fixed aiming reticle; a compass tape
// runs along the top and a mode/armed/throttle bar along the bottom.
//
// `flight` carries (units in brackets):
//   pitch, roll [deg, +nose up / +right bank], heading [deg true]
//   alt [m above home], vario [m/s, + climbing], groundSpeed [m/s]
//   homeDist [m], homeBearing [deg true, bearing FROM the aircraft TO home]
//   sats, fix, hdop, mode, armed, flightTime [s], throttle [0..100 %]
//   batteryV, cellV, cells, currentA, mah, batteryPct, rssi [0..254]
//   vtype (MAV_TYPE), messages [{text, age}], warnings [text]
//
// Style lives in COPTER_THEME and COPTER_CFG; nothing else hard-codes a
// colour. Change `ink` / `accent` to recolour the whole HUD.

import { OSD_W, OSD_H } from './fpv_osd.js';

export const COPTER_THEME = {
  ink: '#6dff9b',                       // numerals, ticks, lines
  dim: '#3fae6a',                       // labels, unlit scale marks
  accent: '#4fdcff',                    // reticle, bars, radar
  warn: '#ffd23f',
  bad: '#ff5a5a',
  panel: 'rgba(6, 30, 44, 0.55)',       // panel fill
  panelEdge: 'rgba(109, 255, 155, 0.55)',
  halo: 'rgba(0, 16, 10, 0.75)',        // outline behind free-standing text
};

export const COPTER_CFG = {
  center: { x: 640, y: 360 },
  // Lens FOV across the screen (16:9 split of a 110 deg diagonal), the same
  // derivation FpvOsd.configure uses, so one FOV setting serves both HUDs.
  hfovDeg: 102.5,
  vfovDeg: 70.0,
  camUptiltDeg: 0,         // FPV cameras are tilted UP from the nose (deg)
  ladder: { step: 10, max: 60, rung: 62, gap: 30, horizon: 170, clipR: 215 },
  reticle: { r: 104 },
  compass: { x: 640, y: 14, w: 520, ppd: 2.8 },
  speedMaxKmh: 120,        // ground-speed bar full scale
  alt: { ppu: 3, major: 10, minor: 5 },   // px per metre / tape spacing in m
  vsi: { range: 5 },       // +/- m/s on the tape
  lowBatPct: 30,
  critBatPct: 15,
  lowCellV: 3.5,
};

const FONT = "'JetBrains Mono', ui-monospace, monospace";
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap180 = (d) => ((d + 540) % 360) - 180;
const fin = (v) => Number.isFinite(v);

// Set per render() so a caller can pass its own palette/config.
let T = COPTER_THEME;
let K = COPTER_CFG;

// MAV_TYPE values that are multirotors / helicopters, and the VTOL types
// (which fly as aircraft, so Auto keeps them on the plane HUD).
const COPTER_TYPES = new Set([2, 3, 4, 13, 14, 15, 29]);
const VEHICLE_NAMES = { 2: 'QUAD', 3: 'COAX', 4: 'HELI', 13: 'HEXA', 14: 'OCTA', 15: 'TRI', 29: 'DODECA' };

// Which HUD to draw: the OSD tab's choice ('plane' | 'copter' | 'auto'),
// where 'auto' follows the heartbeat's vehicle type.
export function resolveHud(pref, mavType) {
  if (pref === 'copter') return 'copter';
  if (pref === 'auto') return COPTER_TYPES.has(mavType) ? 'copter' : 'plane';
  return 'plane';
}

// ---------------------------------------------------------------- primitives

function stroke(ctx, o = {}) {
  const { w = 1.2, color = T.ink, dash = null, halo = 0 } = o;
  ctx.save();
  ctx.setLineDash(dash || []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (halo > 0) {
    ctx.strokeStyle = T.halo;
    ctx.lineWidth = w + halo;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

function poly(ctx, pts, o = {}) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (o.close) ctx.closePath();
  stroke(ctx, o);
}

function seg(ctx, x1, y1, x2, y2, o = {}) { poly(ctx, [[x1, y1], [x2, y2]], o); }

function txt(ctx, s, x, y, o = {}) {
  const { size = 13, align = 'left', baseline = 'middle', color = T.ink, halo = 0 } = o;
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (halo > 0) {
    ctx.lineWidth = halo;
    ctx.strokeStyle = T.halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

// Corner-cut panel: translucent fill, hairline edge, bracketed corners. `cut`
// picks the chamfered corner ('br' | 'bl' | 'tr' | 'tl').
function panel(ctx, x, y, w, h, cut = 'br', c = 12) {
  // Corners in drawing order, with the chamfered one replaced by two points.
  const corners = {
    tl: [[x, y + c], [x + c, y]],
    tr: [[x + w - c, y], [x + w, y + c]],
    br: [[x + w, y + h - c], [x + w - c, y + h]],
    bl: [[x + c, y + h], [x, y + h - c]],
  };
  const plain = { tl: [[x, y]], tr: [[x + w, y]], br: [[x + w, y + h]], bl: [[x, y + h]] };
  const shape = [];
  for (const name of ['tl', 'tr', 'br', 'bl']) shape.push(...(name === cut ? corners[name] : plain[name]));
  ctx.beginPath();
  ctx.moveTo(shape[0][0], shape[0][1]);
  for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i][0], shape[i][1]);
  ctx.closePath();
  ctx.fillStyle = T.panel;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = T.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Brackets on the three square corners anchor the panel.
  const b = 11;
  ctx.beginPath();
  if (cut !== 'tl') { ctx.moveTo(x, y + b); ctx.lineTo(x, y); ctx.lineTo(x + b, y); }
  if (cut !== 'tr') { ctx.moveTo(x + w - b, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + b); }
  if (cut !== 'br') { ctx.moveTo(x + w, y + h - b); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - b, y + h); }
  if (cut !== 'bl') { ctx.moveTo(x + b, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - b); }
  stroke(ctx, { w: 2, color: T.ink });
}

// Segmented bar: `n` cells, the first round(frac*n) lit.
function segBar(ctx, x, y, w, h, n, frac, color = T.accent) {
  const gap = 2;
  const cw = (w - gap * (n - 1)) / n;
  const lit = fin(frac) ? Math.round(clamp(frac, 0, 1) * n) : 0;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i < lit ? color : 'rgba(79, 220, 255, 0.16)';
    ctx.fillRect(x + i * (cw + gap), y, cw, h);
  }
}

const fmt1 = (v) => (fin(v) ? v.toFixed(1) : '--');
function fmtTime(sec) {
  if (!fin(sec) || sec < 0) return '--:--';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function fmtDist(m) {
  if (!fin(m)) return '--';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// ---------------------------------------------------------------- centre

// Attitude ladder: world-fixed rungs, rolled with the aircraft and clipped to
// a disc so they never run into the side panels. Rung placement is the exact
// rectilinear mapping for a camera tilted up by camUptiltDeg.
function drawLadder(ctx, f) {
  const { x: cx, y: cy } = K.center;
  const L = K.ladder;
  const pitch = f.pitch || 0;
  const roll = clamp(f.roll || 0, -180, 180);
  const cam = -(Number.isFinite(f.camUptiltDeg) ? f.camUptiltDeg : K.camUptiltDeg);
  const ty = Math.tan((K.vfovDeg * DEG) / 2);
  const yFor = (p) => (-Math.tan((p - pitch + cam) * DEG) / ty) * (OSD_H / 2);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, L.clipR, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-roll * DEG);

  for (let p = -L.max; p <= L.max; p += L.step) {
    const y = yFor(p);
    if (Math.abs(y) > 400) continue;
    if (p === 0) {
      // Horizon: long line with a centre gap and end drops.
      for (const s of [-1, 1]) {
        poly(ctx, [[s * L.gap, y], [s * L.horizon, y], [s * L.horizon, y + 8]], { w: 1.6, halo: 2.4 });
      }
      continue;
    }
    const col = p < 0 ? T.dim : T.ink;
    const dash = p < 0 ? [7, 5] : null;
    const hook = p > 0 ? 7 : -7;      // end hooks point toward the horizon
    for (const s of [-1, 1]) {
      poly(ctx, [[s * L.gap, y], [s * L.rung, y], [s * L.rung, y + hook]], { w: 1.2, color: col, dash, halo: 2 });
      txt(ctx, String(Math.abs(p)), s * (L.rung + 8), y, {
        size: 12, align: s > 0 ? 'left' : 'right', color: col, halo: 2.4,
      });
    }
  }
  ctx.restore();
}

// Fixed aiming reticle: four cyan corner arcs, a gapped cross with end caps,
// a centre dot, and a roll pointer that rides the ring.
function drawReticle(ctx, f) {
  const { x: cx, y: cy } = K.center;
  const r = K.reticle.r;

  // Four diagonal arcs, gaps on the cardinal points.
  ctx.beginPath();
  for (const mid of [45, 135, 225, 315]) {
    ctx.moveTo(cx + Math.cos((mid - 26) * DEG) * r, cy + Math.sin((mid - 26) * DEG) * r);
    ctx.arc(cx, cy, r, (mid - 26) * DEG, (mid + 26) * DEG);
  }
  stroke(ctx, { w: 3, color: T.accent, halo: 2.5 });

  // Cross: vertical arm up ends in a T cap, the others are plain ticks.
  const g = 9;
  ctx.beginPath();
  ctx.moveTo(cx, cy - g); ctx.lineTo(cx, cy - 78);
  ctx.moveTo(cx - 8, cy - 78); ctx.lineTo(cx + 8, cy - 78);
  ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + 78);
  ctx.moveTo(cx - g, cy); ctx.lineTo(cx - 78, cy);
  ctx.moveTo(cx + g, cy); ctx.lineTo(cx + 78, cy);
  stroke(ctx, { w: 1.4, halo: 2.2 });
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = T.ink;
  ctx.fill();

  // Roll pointer: a small triangle on the ring that moves with bank angle,
  // 0 at the top; fixed ticks at 0 / +-30 / +-60 show the scale.
  const roll = clamp(f.roll || 0, -75, 75);
  ctx.beginPath();
  for (const a of [-60, -30, 0, 30, 60]) {
    const ang = (-90 + a) * DEG;
    ctx.moveTo(cx + Math.cos(ang) * (r + 4), cy + Math.sin(ang) * (r + 4));
    ctx.lineTo(cx + Math.cos(ang) * (r + 11), cy + Math.sin(ang) * (r + 11));
  }
  stroke(ctx, { w: 1.4, color: T.accent, halo: 1.8 });
  const pa = (-90 + roll) * DEG;
  ctx.save();
  ctx.translate(cx + Math.cos(pa) * (r - 6), cy + Math.sin(pa) * (r - 6));
  ctx.rotate(pa + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -5); ctx.lineTo(-5, 4); ctx.lineTo(5, 4);
  ctx.closePath();
  ctx.fillStyle = T.ink;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- compass

const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

function drawCompass(ctx, f) {
  const { x, y, w, ppd } = K.compass;
  const hdg = ((f.heading || 0) % 360 + 360) % 360;
  const half = w / 2;
  const top = y + 20, tickTop = top;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - half, y, w, 44);
  ctx.clip();
  const from = Math.floor((hdg - half / ppd) / 10) * 10;
  const to = Math.ceil((hdg + half / ppd) / 10) * 10;
  ctx.beginPath();
  for (let b = from; b <= to; b += 10) {
    const px = x + wrap180(b - hdg) * ppd;
    const norm = ((b % 360) + 360) % 360;
    const major = norm % 30 === 0;
    ctx.moveTo(px, tickTop);
    ctx.lineTo(px, tickTop + (major ? 11 : 6));
  }
  // Baseline.
  ctx.moveTo(x - half, tickTop); ctx.lineTo(x + half, tickTop);
  stroke(ctx, { w: 1.3, halo: 1.6 });
  for (let b = from; b <= to; b += 10) {
    const norm = ((b % 360) + 360) % 360;
    if (norm % 30 !== 0) continue;
    const px = x + wrap180(b - hdg) * ppd;
    const label = CARD[norm] || String(norm).padStart(3, '0');
    txt(ctx, label, px, y + 9, { size: CARD[norm] ? 16 : 13, align: 'center', halo: 2.4 });
  }
  ctx.restore();

  // Readout box and pointer.
  const bw = 80, bh = 34, by = y + 44;
  ctx.beginPath();
  ctx.rect(x - bw / 2, by, bw, bh);
  ctx.fillStyle = T.panel;
  ctx.fill();
  stroke(ctx, { w: 1.4 });
  txt(ctx, String(Math.round(hdg) % 360).padStart(3, '0'), x, by + bh / 2 + 1, { size: 24, align: 'center' });
  ctx.beginPath();
  ctx.moveTo(x - 7, by + bh + 7); ctx.lineTo(x + 7, by + bh + 7); ctx.lineTo(x, by + bh + 1);
  ctx.closePath();
  ctx.fillStyle = T.accent;
  ctx.fill();
}

// ---------------------------------------------------------------- left column

function drawStatus(ctx, f) {
  const x = 22, y = 20, w = 196, h = 76;
  panel(ctx, x, y, w, h, 'br');
  const name = VEHICLE_NAMES[f.vtype] || 'COPTER';
  txt(ctx, name, x + 14, y + 19, { size: 18 });
  txt(ctx, 'SYS: ONLINE', x + 14, y + 40, { size: 12, color: T.accent });
  txt(ctx, `T+ ${fmtTime(f.flightTime)}`, x + 14, y + 60, { size: 12, color: T.dim });
}

function batteryColor(f) {
  const pct = f.batteryPct;
  const cell = cellVoltage(f);
  if ((fin(pct) && pct <= K.critBatPct) || (fin(cell) && cell < K.lowCellV - 0.2)) return T.bad;
  if ((fin(pct) && pct <= K.lowBatPct) || (fin(cell) && cell < K.lowCellV)) return T.warn;
  return null;
}
function cellVoltage(f) {
  if (fin(f.cells) && f.cells > 0 && fin(f.batteryV)) return f.batteryV / f.cells;
  return fin(f.cellV) ? f.cellV : NaN;
}

function drawBattery(ctx, f) {
  const x = 22, y = 106, w = 250, h = 164;
  panel(ctx, x, y, w, h, 'br');
  const warn = batteryColor(f);
  txt(ctx, 'BATTERY', x + 14, y + 18, { size: 14, color: T.accent });

  const pct = f.batteryPct;
  txt(ctx, 'CHARGE', x + 14, y + 44, { size: 12, color: T.dim });
  txt(ctx, fin(pct) ? `${Math.round(pct)}%` : '--%', x + 92, y + 44, { size: 14, align: 'right', color: warn || T.ink });
  segBar(ctx, x + 102, y + 38, w - 102 - 14, 12, 10, fin(pct) ? pct / 100 : NaN, warn || T.accent);

  const cell = cellVoltage(f);
  txt(ctx, 'CELL', x + 14, y + 68, { size: 12, color: T.dim });
  txt(ctx, fin(cell) ? `${cell.toFixed(2)}V` : '--', x + 92, y + 68, { size: 14, align: 'right', color: warn || T.ink });
  segBar(ctx, x + 102, y + 62, w - 102 - 14, 12, 10, fin(cell) ? (cell - 3.3) / (4.2 - 3.3) : NaN, warn || T.accent);

  seg(ctx, x + 14, y + 88, x + w - 14, y + 88, { w: 1, color: T.panelEdge });
  const rows = [
    ['VOLTAGE', fin(f.batteryV) ? `${f.batteryV.toFixed(1)} V` : '--'],
    ['CURRENT', fin(f.currentA) ? `${f.currentA.toFixed(1)} A` : '--'],
    ['USED', fin(f.mah) ? `${Math.round(f.mah)} mAh` : '--'],
  ];
  rows.forEach(([k, v], i) => {
    const yy = y + 106 + i * 19;
    txt(ctx, k, x + 14, yy, { size: 12, color: T.dim });
    txt(ctx, v, x + w - 14, yy, { size: 14, align: 'right', color: k === 'VOLTAGE' && warn ? warn : T.ink });
  });
}

function drawAltitude(ctx, f) {
  const x = 22, y = 288, w = 150, h = 240;
  panel(ctx, x, y, w, h, 'br');
  const alt = fin(f.alt) ? f.alt : 0;
  txt(ctx, 'ALTITUDE', x + 14, y + 18, { size: 12, color: T.accent });
  const big = Math.abs(alt) < 100 ? alt.toFixed(1) : String(Math.round(alt));
  txt(ctx, big, x + 14, y + 46, { size: 30 });
  txt(ctx, 'm', x + w - 14, y + 52, { size: 14, align: 'right', color: T.dim });

  // Scrolling tape: current value pinned to the middle.
  const top = y + 74, bot = y + h - 12, mid = (top + bot) / 2;
  const { ppu, major, minor } = K.alt;
  const spineX = x + w - 26;
  const half = (bot - top) / 2 / ppu;
  const lo = Math.floor((alt - half) / minor) * minor;
  const hi = Math.ceil((alt + half) / minor) * minor;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4, top, w - 8, bot - top);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(spineX, top); ctx.lineTo(spineX, bot);
  for (let v = lo; v <= hi; v += minor) {
    const yy = mid + (alt - v) * ppu;
    const isMajor = Math.abs(v % major) < 1e-6;
    ctx.moveTo(spineX, yy);
    ctx.lineTo(spineX - (isMajor ? 12 : 6), yy);
  }
  stroke(ctx, { w: 1.2 });
  for (let v = lo; v <= hi; v += minor) {
    if (Math.abs(v % major) > 1e-6) continue;
    const yy = mid + (alt - v) * ppu;
    if (yy < top + 8 || yy > bot - 8) continue;   // never draw a half-clipped number
    txt(ctx, String(Math.round(v)), spineX - 18, yy, { size: 12, align: 'right',
      color: Math.abs(yy - mid) < 11 ? T.dim : T.ink });
  }
  ctx.restore();

  // Pointer.
  ctx.beginPath();
  ctx.moveTo(spineX + 3, mid); ctx.lineTo(spineX + 14, mid - 6); ctx.lineTo(spineX + 14, mid + 6);
  ctx.closePath();
  ctx.fillStyle = T.accent;
  ctx.fill();
}

function drawSpeed(ctx, f) {
  const x = 22, y = 574, w = 214, h = 118;
  panel(ctx, x, y, w, h, 'tr');
  const kmh = fin(f.groundSpeed) ? f.groundSpeed * 3.6 : NaN;
  txt(ctx, 'GROUND SPEED', x + 14, y + 20, { size: 12, color: T.accent });
  txt(ctx, fin(kmh) ? String(Math.round(kmh)) : '--', x + 14, y + 60, { size: 40 });
  txt(ctx, 'km/h', x + w - 14, y + 66, { size: 14, align: 'right', color: T.dim });
  segBar(ctx, x + 14, y + h - 30, w - 28, 14, 8, fin(kmh) ? kmh / K.speedMaxKmh : NaN);
}

// ---------------------------------------------------------------- right column

function drawGps(ctx, f) {
  const w = 196, h = 108, x = OSD_W - 22 - w, y = 20;
  panel(ctx, x, y, w, h, 'bl');
  txt(ctx, 'GPS', x + 14, y + 20, { size: 15, color: T.accent });
  // Satellite-dish glyph.
  const gx = x + w - 30, gy = y + 24;
  ctx.beginPath();
  ctx.arc(gx, gy, 12, 0, Math.PI * 2);
  ctx.moveTo(gx - 12, gy); ctx.lineTo(gx + 12, gy);
  ctx.moveTo(gx, gy - 12); ctx.lineTo(gx, gy + 12);
  stroke(ctx, { w: 1.3, color: T.accent });

  const sats = fin(f.sats) ? Math.round(f.sats) : '--';
  const fix = f.fix || 0;
  const fixTxt = fix >= 3 ? '3D' : fix === 2 ? '2D' : 'NONE';
  const fixCol = fix >= 3 ? T.ink : fix === 2 ? T.warn : T.bad;
  txt(ctx, `${sats} sats`, x + 14, y + 48, { size: 20, color: fix >= 3 ? T.ink : T.warn });
  txt(ctx, 'LOCK', x + 14, y + 72, { size: 12, color: T.dim });
  txt(ctx, fixTxt, x + 66, y + 72, { size: 14, color: fixCol });
  txt(ctx, 'HDOP', x + 14, y + 92, { size: 12, color: T.dim });
  txt(ctx, fmt1(f.hdop), x + 66, y + 92, { size: 14, color: fin(f.hdop) && f.hdop > 2 ? T.warn : T.ink });
}

// RC link quality from RC_CHANNELS_RAW.rssi (0..254), shown as percent.
function drawLink(ctx, f) {
  const w = 196, h = 58, x = OSD_W - 22 - w, y = 138;
  panel(ctx, x, y, w, h, 'bl');
  const pct = fin(f.rssi) ? clamp((f.rssi / 254) * 100, 0, 100) : NaN;
  txt(ctx, 'RC LINK', x + 14, y + 20, { size: 13, color: T.accent });
  const col = !fin(pct) ? T.dim : pct < 25 ? T.bad : pct < 50 ? T.warn : T.ink;
  txt(ctx, fin(pct) ? `${Math.round(pct)}%` : '--', x + w - 14, y + 20, { size: 16, align: 'right', color: col });
  const bars = fin(pct) ? Math.ceil((pct / 100) * 6) : 0;
  for (let i = 0; i < 6; i++) {
    const bh = 5 + i * 3;
    ctx.fillStyle = i < bars ? (col === T.ink ? T.accent : col) : 'rgba(79, 220, 255, 0.16)';
    ctx.fillRect(x + 14 + i * 11, y + h - 12 - bh, 8, bh);
  }
}

function drawVsi(ctx, f) {
  const w = 142, h = 240, x = OSD_W - 22 - w, y = 288;
  panel(ctx, x, y, w, h, 'bl');
  const range = K.vsi.range;
  const v = fin(f.vsi) ? f.vsi : (fin(f.vario) ? f.vario : 0);
  txt(ctx, 'VERT SPEED', x + 14, y + 18, { size: 12, color: T.accent });
  txt(ctx, `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`, x + 14, y + 46, { size: 26 });
  txt(ctx, 'm/s', x + w - 14, y + 52, { size: 13, align: 'right', color: T.dim });

  const top = y + 82, bot = y + h - 20, mid = (top + bot) / 2;
  const spineX = x + 34;
  const ppu = (bot - top) / 2 / range;
  ctx.beginPath();
  ctx.moveTo(spineX, top); ctx.lineTo(spineX, bot);
  for (let s = -range; s <= range + 1e-6; s += range / 4) {
    const yy = mid - s * ppu;
    ctx.moveTo(spineX, yy); ctx.lineTo(spineX + (Math.abs(s % (range / 2)) < 1e-6 ? 12 : 6), yy);
  }
  stroke(ctx, { w: 1.2 });
  for (let s = range; s >= -range - 1e-6; s -= range / 2) {
    const yy = mid - s * ppu;
    txt(ctx, s === 0 ? '0' : s.toFixed(1), spineX + 20, yy, { size: 12, color: T.ink });
  }
  // Marker on the left of the spine, clamped to the scale.
  const my = mid - clamp(v, -range, range) * ppu;
  ctx.beginPath();
  ctx.moveTo(spineX - 2, my); ctx.lineTo(spineX - 14, my - 6); ctx.lineTo(spineX - 14, my + 6);
  ctx.closePath();
  ctx.fillStyle = Math.abs(v) > range ? T.warn : T.accent;
  ctx.fill();
}

// Home radar: heading-up, so "up" is where the nose points and the blip sits
// at the home bearing relative to it. Range auto-steps to keep home on the disc.
const RADAR_RANGES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
function radarRange(dist) {
  if (!fin(dist)) return RADAR_RANGES[0];
  return RADAR_RANGES.find((r) => dist <= r * 0.95) || RADAR_RANGES[RADAR_RANGES.length - 1];
}

function drawRadar(ctx, f) {
  const w = 222, h = 160, x = OSD_W - 22 - w, y = 540;
  panel(ctx, x, y, w, h, 'tl');
  txt(ctx, 'HOME', x + 14, y + 20, { size: 12, color: T.accent });
  txt(ctx, fmtDist(f.homeDist), x + w - 14, y + 20, { size: 16, align: 'right' });

  const R = 54, cx = x + w / 2, cy = y + 24 + (h - 24) / 2 + 2;
  ctx.beginPath();
  for (const k of [1, 2 / 3, 1 / 3]) { ctx.moveTo(cx + R * k, cy); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); }
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  stroke(ctx, { w: 1, color: T.ink });
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  stroke(ctx, { w: 1.6, color: T.ink });
  ctx.restore();

  // Own aircraft.
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 4.5, cy + 4); ctx.lineTo(cx + 4.5, cy + 4);
  ctx.closePath();
  ctx.fillStyle = T.ink;
  ctx.fill();

  const range = radarRange(f.homeDist);
  txt(ctx, range >= 1000 ? `${range / 1000}km` : `${range}m`, x + w - 12, y + h - 12,
    { size: 10, align: 'right', color: T.dim });
  if (!fin(f.homeDist) || !fin(f.homeBearing)) return;

  const rel = (f.homeBearing - (f.heading || 0)) * DEG;
  const r = Math.min(f.homeDist / range, 1) * R;
  const bx = cx + Math.sin(rel) * r, by = cy - Math.cos(rel) * r;
  seg(ctx, cx, cy, bx, by, { w: 1.4, color: T.accent });
  // Home blip: ring with an arrowhead along the bearing.
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(rel);
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(-5, 3); ctx.lineTo(5, 3);
  ctx.closePath();
  ctx.fillStyle = T.accent;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- bottom

function drawModeBar(ctx, f) {
  const cx = OSD_W / 2, y = 650, h = 40, hw = 280;
  ctx.beginPath();
  ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y);
  ctx.lineTo(cx + hw - 14, y + h); ctx.lineTo(cx - hw + 14, y + h);
  ctx.closePath();
  ctx.fillStyle = T.panel;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = T.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  // Bracket ends.
  poly(ctx, [[cx - hw + 12, y + h + 4], [cx - hw - 6, y + h + 4], [cx - hw - 6, y - 4]], { w: 2 });
  poly(ctx, [[cx + hw - 12, y + h + 4], [cx + hw + 6, y + h + 4], [cx + hw + 6, y - 4]], { w: 2 });

  const mid = y + h / 2 + 1;
  const thr = fin(f.throttle) ? Math.round(clamp(f.throttle <= 1 && f.throttle > 0 ? f.throttle * 100 : f.throttle, 0, 100)) : NaN;
  const diamond = (dx) => {
    ctx.beginPath();
    ctx.moveTo(dx, mid - 4); ctx.lineTo(dx + 4, mid); ctx.lineTo(dx, mid + 4); ctx.lineTo(dx - 4, mid);
    ctx.closePath();
    ctx.fillStyle = T.accent;
    ctx.fill();
  };
  txt(ctx, `MODE: ${f.mode || '---'}`, cx - 100, mid, { size: 15, align: 'center' });
  diamond(cx - 30);
  txt(ctx, f.armed ? 'ARMED' : 'DISARMED', cx + 40, mid, { size: 15, align: 'center', color: f.armed ? T.ink : T.warn });
  diamond(cx + 112);
  txt(ctx, `THR: ${fin(thr) ? thr : '--'}%`, cx + 188, mid, { size: 15, align: 'center',
    color: fin(thr) && thr > 85 ? T.warn : T.ink });
}

// STATUSTEXT warnings and messages float above the mode bar.
function drawMessages(ctx, f) {
  const lines = [];
  for (const w of Array.isArray(f.warnings) ? f.warnings.filter(Boolean) : []) lines.push([String(w), T.warn, 1]);
  const ttl = 5;
  for (const m of Array.isArray(f.messages) ? f.messages : []) {
    if (m && fin(m.age) && m.age < ttl) lines.push([m.text, T.ink, clamp(1 - m.age / ttl, 0, 1)]);
  }
  lines.slice(-3).forEach(([text, color, alpha], i, arr) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    txt(ctx, text, OSD_W / 2, 636 - (arr.length - 1 - i) * 18, { size: 13, align: 'center', color, halo: 2.4 });
    ctx.restore();
  });
}

// ---------------------------------------------------------------- class

export class CopterOsd {
  constructor({ getCanvas, theme = COPTER_THEME, cfg = COPTER_CFG } = {}) {
    this.getCanvas = getCanvas;
    this.theme = { ...COPTER_THEME, ...(theme || {}) };
    this.cfg = { ...COPTER_CFG, ...(cfg || {}) };
    this.canvas = null;
    this.smoothTau = 0.10;
    this.clear();
  }

  // Runtime options from the OSD tab (same object FpvOsd.configure takes).
  // Shares the lens FOV and smoothing with the plane HUD; the camera tilt is
  // the copter's own because an FPV camera is tilted up, not down.
  configure(o = {}) {
    const diag = Number.isFinite(o.fovDiag) ? Math.max(40, Math.min(170, o.fovDiag)) : 110;
    const t = Math.tan((diag * Math.PI) / 360);
    const aspect = OSD_W / OSD_H;
    const tv = t / Math.hypot(1, aspect);
    this.cfg = {
      ...this.cfg,
      hfovDeg: (Math.atan(aspect * tv) * 360) / Math.PI,
      vfovDeg: (Math.atan(tv) * 360) / Math.PI,
      camUptiltDeg: Number.isFinite(o.copterCamUptilt) ? o.copterCamUptilt : this.cfg.camUptiltDeg,
      speedMaxKmh: Number.isFinite(o.copterSpeedMax) && o.copterSpeedMax > 0 ? o.copterSpeedMax : this.cfg.speedMaxKmh,
    };
    this.smoothTau = Number.isFinite(o.smoothingMs) ? Math.max(0, o.smoothingMs / 1000) : 0.10;
  }

  attach(canvas) { this.canvas = canvas; }

  resize(cssW, cssH, dpr = 1) {
    const c = this.canvas;
    if (!c) return;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  clear() {
    const c = this.canvas;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    this._sm = null;
    this._smAt = 0;
    this._altSamples = [];
    this._vsi = 0;
  }

  // Vertical speed from the altitude slope, so it keeps working when VFR_HUD
  // is slower than the position stream (same approach as the plane HUD).
  _altVsi(alt, nowMs) {
    if (!Number.isFinite(alt)) return this._vsi;
    const h = this._altSamples;
    h.push([nowMs, alt]);
    while (h.length > 2 && h[0][0] < nowMs - 500) h.shift();
    if (h.length < 2) return this._vsi;
    const a = h[0], b = h[h.length - 1];
    const dt = (b[0] - a[0]) / 1000;
    if (dt < 0.15) return this._vsi;
    const target = (b[1] - a[1]) / dt;
    this._vsi += (target - this._vsi) * (1 - Math.exp(-dt / 0.25));
    return this._vsi;
  }

  // Time-based smoothing on the render clock; heading wraps, discrete state
  // follows the latest message immediately.
  _smooth(flight, nowMs) {
    const dt = this._smAt ? (nowMs - this._smAt) / 1000 : 0;
    this._smAt = nowMs;
    if (!this._sm || dt <= 0 || dt > 0.5) { this._sm = { ...flight }; return this._sm; }
    const s = this._sm;
    const k = 1 - Math.exp(-dt / (this.smoothTau || 0.10));
    for (const key of ['pitch', 'roll', 'alt', 'vario', 'groundSpeed', 'homeDist']) {
      const t = flight[key];
      if (!Number.isFinite(t)) continue;
      s[key] = Number.isFinite(s[key]) ? s[key] + (t - s[key]) * k : t;
    }
    for (const key of ['heading', 'homeBearing']) {
      const t = flight[key];
      if (!Number.isFinite(t)) continue;
      if (!Number.isFinite(s[key])) { s[key] = t; continue; }
      const d = ((t - s[key] + 540) % 360) - 180;
      s[key] = ((s[key] + d * k) % 360 + 360) % 360;
    }
    for (const key of ['sats', 'fix', 'hdop', 'mode', 'armed', 'batteryV', 'cellV', 'cells',
      'currentA', 'mah', 'batteryPct', 'flightTime', 'throttle', 'rssi', 'vtype',
      'messages', 'warnings']) {
      if (flight[key] !== undefined) s[key] = flight[key];
    }
    return s;
  }

  render(flight, nowMs) {
    const c = this.canvas;
    if (!c || !flight) return;
    T = this.theme;
    K = this.cfg;
    if (Number.isFinite(nowMs)) {
      flight = this._smooth(flight, nowMs);
      flight = { ...flight, vsi: this._altVsi(flight.alt, nowMs) };
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / OSD_W, c.height / OSD_H);
    ctx.setTransform(s, 0, 0, s, (c.width - OSD_W * s) / 2, (c.height - OSD_H * s) / 2);

    drawLadder(ctx, flight);
    drawReticle(ctx, flight);
    drawCompass(ctx, flight);
    drawStatus(ctx, flight);
    drawBattery(ctx, flight);
    drawAltitude(ctx, flight);
    drawSpeed(ctx, flight);
    drawGps(ctx, flight);
    drawLink(ctx, flight);
    drawVsi(ctx, flight);
    drawRadar(ctx, flight);
    drawModeBar(ctx, flight);
    drawMessages(ctx, flight);
  }
}
