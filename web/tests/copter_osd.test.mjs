import test from 'node:test';
import assert from 'node:assert/strict';
import { CopterOsd, resolveHud } from '../ui/src/lib/fpv_osd_copter.js';

// A canvas whose 2D context records every fillText/strokeText string and
// accepts any other call, so render() runs end to end without a browser.
function fakeCanvas() {
  const texts = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'fillText') return (s) => { texts.push(String(s)); };
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: 1280, height: 720, getContext: () => ctx, texts };
}

function flight(over = {}) {
  return {
    pitch: 4, roll: -8, heading: 17, alt: 74.2, vario: 2.1, groundSpeed: 17.5,
    homeDist: 15600, homeBearing: 52,
    sats: 14, fix: 3, hdop: 0.7, mode: 'LOITER', armed: true, flightTime: 192,
    throttle: 45, batteryV: 23.8, cellV: 3.97, cells: 6, currentA: 18.7, mah: 1240, batteryPct: 78,
    rssi: 200, vtype: 2, messages: [], warnings: [],
    ...over,
  };
}

function osd() {
  const c = fakeCanvas();
  const hud = new CopterOsd({});
  hud.attach(c);
  hud.configure({ smoothingMs: 0 });
  return { c, hud };
}

test('resolveHud: explicit choice wins, auto follows the vehicle type', () => {
  assert.equal(resolveHud('plane', 2), 'plane');
  assert.equal(resolveHud('copter', 1), 'copter');
  assert.equal(resolveHud('auto', 2), 'copter');    // quad
  assert.equal(resolveHud('auto', 13), 'copter');   // hexa
  assert.equal(resolveHud('auto', 4), 'copter');    // helicopter
  assert.equal(resolveHud('auto', 1), 'plane');     // fixed wing
  assert.equal(resolveHud('auto', 20), 'plane');    // VTOL flies as an aircraft
  assert.equal(resolveHud('auto', 0), 'plane');     // no heartbeat yet
  assert.equal(resolveHud(undefined, 2), 'plane');  // unset setting keeps the plane HUD
});

test('render draws the instruments from the flight state', () => {
  const { c, hud } = osd();
  hud.render(flight(), 1000);
  const t = c.texts;
  for (const want of ['QUAD', '017', '74.2', '63', '14 sats', '3D', '0.7', '78%', '25.6 V'.replace('25.6', '23.8'),
    '18.7 A', '1240 mAh', 'MODE: LOITER', 'ARMED', 'THR: 45%', '15.6 km', 'T+ 03:12', '79%']) {
    assert.ok(t.includes(want), `missing ${want} in ${JSON.stringify(t)}`);
  }
});

test('render shows unknowns as -- and never throws on a bare state', () => {
  const { c, hud } = osd();
  const bare = flight({
    batteryV: NaN, cellV: NaN, cells: 0, currentA: NaN, mah: NaN, batteryPct: NaN,
    rssi: NaN, homeDist: NaN, homeBearing: NaN, hdop: NaN, groundSpeed: NaN, fix: 0, sats: NaN,
    armed: false, throttle: NaN, mode: '',
  });
  hud.render(bare, 1000);
  assert.ok(c.texts.includes('--%'));            // charge
  assert.ok(c.texts.includes('MODE: ---'));
  assert.ok(c.texts.includes('DISARMED'));
  assert.ok(c.texts.includes('THR: --%'));
  assert.ok(!c.texts.some((s) => /NaN|undefined/.test(s)), JSON.stringify(c.texts));
});

test('range steps keep home on the radar disc; metres below a km', () => {
  const { c, hud } = osd();
  hud.render(flight({ homeDist: 420 }), 1000);
  assert.ok(c.texts.includes('420 m'));
  assert.ok(c.texts.includes('500m'));           // 420 <= 0.95 * 500
  const b = osd();
  b.hud.render(flight({ homeDist: 15600 }), 1000);
  assert.ok(b.c.texts.includes('25km'));
});

test('vertical speed follows the altitude slope, signed', () => {
  const { c, hud } = osd();
  // The big readout is the first +/-d.d string of a frame; the tape's own
  // labels (e.g. "-5.0") are drawn after it.
  const readout = (alt, t) => {
    c.texts.length = 0;
    hud.render(flight({ alt }), t);
    return c.texts.find((s) => /^[+-]\d\.\d$/.test(s));
  };
  readout(10, 1000);
  const climb = readout(10.5, 1200);             // +2.5 m/s raw, filtered
  assert.ok(climb.startsWith('+') && parseFloat(climb) > 0, climb);
  readout(9, 1400);
  const sink = readout(8, 1600);
  assert.ok(sink.startsWith('-') && parseFloat(sink) < 0, sink);
});

test('heading wraps through north when smoothing', () => {
  const { hud } = osd();
  hud.configure({ smoothingMs: 100 });
  hud.render(flight({ heading: 350 }), 1000);
  hud.render(flight({ heading: 10 }), 1050);
  const h = hud._sm.heading;
  assert.ok(h > 350 || h < 10, `heading ${h} took the long way round`);
});

test('status messages and warnings are drawn; expired messages are not', () => {
  const { c, hud } = osd();
  hud.render(flight({
    warnings: ['Low Battery'],
    messages: [{ text: 'fresh msg', age: 1 }, { text: 'old msg', age: 9 }],
  }), 1000);
  assert.ok(c.texts.includes('Low Battery'));
  assert.ok(c.texts.includes('fresh msg'));
  assert.ok(!c.texts.includes('old msg'));
});

test('render with no canvas or no flight is a no-op', () => {
  const hud = new CopterOsd({});
  assert.doesNotThrow(() => hud.render(flight(), 1));
  const { hud: h2 } = osd();
  assert.doesNotThrow(() => h2.render(null, 1));
});
