<script>
  import { OSD_DEFAULTS } from '../lib/ui.svelte.js';
  let { osd, onChange } = $props();

  function set(key, value) {
    onChange({ ...osd, [key]: value });
  }
  function num(key, e) {
    const v = Number(e.currentTarget.value);
    if (Number.isFinite(v)) set(key, v);
  }
</script>

<div class="osd-panel">
  <p class="hint">Changes apply immediately to the OSD canvas.</p>

  <h3>HUD style</h3>
  <div class="seg" role="radiogroup" aria-label="HUD style">
    {#each [['plane', 'Plane'], ['copter', 'Copter'], ['auto', 'Auto']] as [id, label]}
      <button type="button" role="radio" aria-checked={osd.hudType === id}
        class:on={osd.hudType === id} onclick={() => set('hudType', id)}>{label}</button>
    {/each}
  </div>
  <p class="hint">Auto picks the copter HUD when the flight controller reports a multirotor or helicopter, otherwise the plane HUD.</p>

  <h3>Lens</h3>
  <label class="field">
    <span>FOV diagonal <em>{osd.fovDiag}°</em></span>
    <input type="range" min="60" max="170" step="1" value={osd.fovDiag}
      oninput={(e) => num('fovDiag', e)} />
  </label>

  <h3>Copter HUD</h3>
  <label class="field">
    <span>Camera uptilt <em>{osd.copterCamUptilt}°</em></span>
    <input type="range" min="0" max="60" step="1" value={osd.copterCamUptilt}
      oninput={(e) => num('copterCamUptilt', e)} />
  </label>
  <label class="field">
    <span>Speed bar full scale <em>{osd.copterSpeedMax} km/h</em></span>
    <input type="range" min="40" max="300" step="10" value={osd.copterSpeedMax}
      oninput={(e) => num('copterSpeedMax', e)} />
  </label>

  <h3>Gimbal</h3>
  <label class="field">
    <span>Camera pitch offset <em>{osd.camPitch}°</em></span>
    <input type="range" min="-30" max="40" step="0.5" value={osd.camPitch}
      oninput={(e) => num('camPitch', e)} />
  </label>
  <div class="two">
    <label class="field">
      <span>Pitch RC</span>
      <input type="number" min="1" max="16" value={osd.gimbalPitchChannel}
        oninput={(e) => num('gimbalPitchChannel', e)} />
    </label>
    <label class="field">
      <span>Pitch strength <em>{osd.gimbalPitchStrength}°</em></span>
      <input type="range" min="0" max="90" step="1" value={osd.gimbalPitchStrength}
        oninput={(e) => num('gimbalPitchStrength', e)} />
    </label>
  </div>
  <label class="check">
    <input type="checkbox" checked={osd.gimbalYawEnabled}
      onchange={(e) => set('gimbalYawEnabled', e.currentTarget.checked)} />
    <span>Use RC yaw for the gimbal</span>
  </label>
  <div class="two" class:disabled={!osd.gimbalYawEnabled}>
    <label class="field">
      <span>Yaw RC</span>
      <input type="number" min="1" max="16" value={osd.gimbalYawChannel}
        oninput={(e) => num('gimbalYawChannel', e)} />
    </label>
    <label class="field">
      <span>Yaw strength <em>{osd.gimbalYawStrength}°</em></span>
      <input type="range" min="0" max="90" step="1" value={osd.gimbalYawStrength}
        oninput={(e) => num('gimbalYawStrength', e)} />
    </label>
  </div>
  <label class="field">
    <span>Throttle RC</span>
    <input type="number" min="1" max="16" value={osd.throttleChannel}
      oninput={(e) => num('throttleChannel', e)} />
  </label>

  <h3>Warnings</h3>
  <label class="field">
    <span>AoA first threshold <em>{osd.aoaWarn}°</em></span>
    <input type="range" min="0" max="30" step="1" value={osd.aoaWarn}
      oninput={(e) => num('aoaWarn', e)} />
  </label>
  <label class="field">
    <span>AoA critical threshold <em>{osd.aoaCritical}°</em></span>
    <input type="range" min="0" max="40" step="1" value={osd.aoaCritical}
      oninput={(e) => num('aoaCritical', e)} />
  </label>
  <label class="field">
    <span>Stall speed <em>{osd.stallSpeed} km/h</em></span>
    <input type="range" min="20" max="100" step="1" value={osd.stallSpeed}
      oninput={(e) => num('stallSpeed', e)} />
  </label>

  <h3>Motion</h3>
  <label class="field">
    <span>Smoothing <em>{osd.smoothingMs} ms</em></span>
    <input type="range" min="0" max="500" step="10" value={osd.smoothingMs}
      oninput={(e) => num('smoothingMs', e)} />
  </label>

  <button class="btn btn-ghost reset" type="button" onclick={() => onChange({ ...OSD_DEFAULTS })}>
    Reset OSD options
  </button>
</div>

<style>
  .osd-panel { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 24px; }
  .hint { margin: 0; font-size: 11px; color: var(--color-neutral-400); line-height: 1.4; }
  h3 { margin: 8px 0 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
       color: var(--color-neutral-400); }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .field > span { display: flex; justify-content: space-between; gap: 8px; }
  .field em { font-style: normal; color: var(--color-accent-300); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two.disabled { opacity: .38; pointer-events: none; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--color-neutral-600, #3a3f55); border-radius: 6px; overflow: hidden; }
  .seg button { padding: 6px 0; font-size: 12px; background: transparent; color: var(--color-neutral-300, #b5bad0); border: 0; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--color-neutral-600, #3a3f55); }
  .seg button.on { background: var(--color-accent-300, #6ea8ff); color: #0b0d17; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  input[type="number"] { width: 100%; }
  .reset { align-self: flex-start; margin-top: 10px; }
</style>
