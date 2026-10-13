/**
 * TOTO Washlet Card — a Lovelace remote for TOTO Washlet smart bidets.
 *
 * Washlets are controlled over infrared, so this card does not talk to the
 * bidet directly. Each button sends a named command through a Home Assistant
 * `remote` entity (e.g. Broadlink learned codes), or runs any entity/action you
 * map it to (ESPHome IR buttons, scripts, input_buttons, ...).
 */

const CARD_VERSION = "0.1.0";

const COMMANDS = {
  stop: { label: "Stop", icon: "mdi:stop" },
  rear: { label: "Rear", icon: "mdi:water" },
  front: { label: "Front", icon: "mdi:flower-tulip-outline" },
  dry: { label: "Dry", icon: "mdi:weather-windy" },
  pressure_down: { label: "Pressure −", icon: "mdi:minus" },
  pressure_up: { label: "Pressure +", icon: "mdi:plus" },
  position_back: { label: "Position back", icon: "mdi:chevron-left" },
  position_forward: { label: "Position forward", icon: "mdi:chevron-right" },
  oscillate: { label: "Oscillate", icon: "mdi:arrow-left-right" },
  pulsate: { label: "Pulsate", icon: "mdi:sine-wave" },
  water_temp: { label: "Water temp", icon: "mdi:thermometer-water" },
  seat_temp: { label: "Seat temp", icon: "mdi:car-seat-heater" },
  dryer_temp: { label: "Dryer temp", icon: "mdi:heat-wave" },
  deodorize: { label: "Deodorize", icon: "mdi:air-filter" },
  flush: { label: "Flush", icon: "mdi:toilet" },
  lid: { label: "Lid", icon: "mdi:arrow-up-down" },
  seat: { label: "Seat", icon: "mdi:seat-outline" },
  user_1: { label: "User 1", icon: "mdi:account" },
  user_2: { label: "User 2", icon: "mdi:account-outline" },
};

const PRIMARY = ["rear", "front", "dry"];
const EXTRAS = [
  "water_temp", "seat_temp", "dryer_temp", "deodorize", "flush", "lid", "seat", "user_1", "user_2",
];
const LEVELS = 5;

const ENTITY_ACTION = {
  button: "button.press",
  input_button: "input_button.press",
  script: "script.turn_on",
  scene: "scene.turn_on",
  automation: "automation.trigger",
};

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const clamp = (n) => Math.max(1, Math.min(LEVELS, n));

class TotoWashletCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("toto-washlet-card-editor");
  }

  static getStubConfig(hass) {
    const remote = Object.keys(hass.states).find((id) => id.startsWith("remote."));
    return { remote: remote || "", device: "toto" };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._mode = null; // "rear" | "front" | "dry" | null — optimistic, IR has no feedback
    this._levels = null; // { pressure, position }
    this._renderKey = "";
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = {
      name: "Washlet",
      show_adjust: true,
      show_extras: true,
      show_levels: true,
      default_pressure: 3,
      default_position: 3,
      hide: [],
      ...config,
    };
    this._renderKey = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 5;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ---------------------------------------------------------------- commands

  _isAvailable(key) {
    const config = this._config;
    if ((config.hide || []).includes(key)) return false;
    return Boolean(config.actions?.[key] || config.remote);
  }

  /** Resolve a command key into a Home Assistant action call. */
  _resolve(key) {
    const config = this._config;
    const override = config.actions?.[key];

    if (typeof override === "string") {
      if (!override.includes(".")) return this._remoteCall(override); // custom command name
      const domain = override.split(".")[0];
      const service = ENTITY_ACTION[domain] || "homeassistant.turn_on";
      return { action: service, target: { entity_id: override } };
    }
    if (override && typeof override === "object") {
      const action = override.action || override.service;
      return { action, data: override.data, target: override.target };
    }
    return this._remoteCall(config.commands?.[key] || key);
  }

  _remoteCall(command) {
    const config = this._config;
    const data = { command };
    if (config.device) data.device = config.device;
    if (config.num_repeats) data.num_repeats = config.num_repeats;
    if (config.delay_secs) data.delay_secs = config.delay_secs;
    return { action: "remote.send_command", target: { entity_id: config.remote }, data };
  }

  async _send(key) {
    const call = this._resolve(key);
    if (!call?.action) return;
    const [domain, service] = call.action.split(".");
    try {
      await this._hass.callService(domain, service, call.data || {}, call.target);
    } catch (err) {
      this.dispatchEvent(
        new CustomEvent("hass-notification", {
          detail: { message: err?.message || String(err) },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  _flash(key) {
    const btn = this.shadowRoot.querySelector(`[data-cmd="${key}"]`);
    if (!btn) return;
    btn.classList.remove("sent");
    void btn.offsetWidth; // restart the animation
    btn.classList.add("sent");
  }

  _onClick(ev) {
    const target = ev.target.closest("[data-cmd]");
    if (!target || target.hasAttribute("disabled")) return;
    const key = target.dataset.cmd;
    const config = this._config;

    // Optimistic bookkeeping: a TOTO resets pressure/position each time a wash starts.
    if (key === "rear" || key === "front") {
      this._mode = key;
      this._levels = { pressure: config.default_pressure, position: config.default_position };
    } else if (key === "dry") {
      this._mode = "dry";
      this._levels = null;
    } else if (key === "stop") {
      this._mode = null;
      this._levels = null;
    } else if (this._levels && /^(pressure|position)_/.test(key)) {
      const [axis, dir] = key.split("_");
      this._levels[axis] = clamp(this._levels[axis] + (dir === "up" || dir === "forward" ? 1 : -1));
    }

    this._send(key);
    this._renderKey = "";
    this._render();
    this._flash(key);
  }

  // ---------------------------------------------------------------- render

  _render() {
    if (!this._hass || !this._config) return;
    const remoteState = this._config.remote ? this._hass.states[this._config.remote] : undefined;
    const key = JSON.stringify([
      this._config,
      remoteState?.state,
      this._mode,
      this._levels,
    ]);
    if (key === this._renderKey) return;
    this._renderKey = key;

    let body;
    if (!this._config.remote && !this._config.actions) {
      body = `<div class="message"><ha-icon icon="mdi:remote"></ha-icon>
        <span>Choose an IR remote entity in the card editor, or map commands with <code>actions:</code>.</span></div>`;
    } else {
      body = this._renderCard(remoteState);
    }
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card>${body}</ha-card>`;
  }

  _button(key, cls = "", content = null) {
    if (!this._isAvailable(key)) return "";
    const meta = COMMANDS[key];
    const label = this._config.labels?.[key] || meta.label;
    const icon = this._config.icons?.[key] || meta.icon;
    return `<button class="${cls}" data-cmd="${key}" title="${esc(label)}" aria-label="${esc(label)}">
      ${content ?? `<ha-icon icon="${esc(icon)}"></ha-icon><span>${esc(label)}</span>`}
    </button>`;
  }

  _renderCard(remoteState) {
    const config = this._config;
    const offline = remoteState && remoteState.state === "unavailable";
    const modeLabel = { rear: "Rear wash", front: "Front wash", dry: "Drying" }[this._mode];

    const primary = PRIMARY.map((k) =>
      this._button(k, `primary ${this._mode === k ? "active" : ""} ${k}`)
    ).join("");

    return `
      <div class="header">
        <div class="badge ${this._mode ? "on" : ""}"><ha-icon icon="${esc(config.icon || "mdi:toilet")}"></ha-icon></div>
        <div class="titles">
          <div class="title">${esc(config.name)}</div>
          <div class="subtitle">${offline ? "IR remote unavailable" : esc(modeLabel || "Ready")}</div>
        </div>
        ${this._button("stop", "stop", `<ha-icon icon="mdi:stop"></ha-icon><span>Stop</span>`)}
      </div>
      <div class="primary-row ${offline ? "dim" : ""}">${primary}</div>
      ${config.show_adjust ? this._renderAdjust() : ""}
      ${config.show_extras ? this._renderExtras() : ""}`;
  }

  _renderAdjust() {
    const showLevels = this._config.show_levels;
    const stepper = (axis, down, up, label, downIcon, upIcon) => {
      if (!this._isAvailable(down) && !this._isAvailable(up)) return "";
      const level = this._levels?.[axis];
      const dots = Array.from(
        { length: LEVELS },
        (_, i) => `<i class="${level && i < level ? "lit" : ""}"></i>`
      ).join("");
      return `
        <div class="stepper">
          ${this._button(down, "step", `<ha-icon icon="${downIcon}"></ha-icon>`)}
          <div class="step-label">
            <span>${label}</span>
            ${showLevels ? `<span class="dots ${level ? "" : "idle"}" title="Estimated — IR has no feedback">${dots}</span>` : ""}
          </div>
          ${this._button(up, "step", `<ha-icon icon="${upIcon}"></ha-icon>`)}
        </div>`;
    };

    const toggles = ["oscillate", "pulsate"].map((k) => this._button(k, "pill")).join("");

    return `
      <div class="section">
        ${stepper("pressure", "pressure_down", "pressure_up", "Pressure", "mdi:minus", "mdi:plus")}
        ${stepper("position", "position_back", "position_forward", "Position", "mdi:chevron-left", "mdi:chevron-right")}
        ${toggles ? `<div class="pills">${toggles}</div>` : ""}
      </div>`;
  }

  _renderExtras() {
    const buttons = EXTRAS.map((k) => this._button(k, "tile")).join("");
    return buttons ? `<div class="extras">${buttons}</div>` : "";
  }
}

const STYLES = `
  :host { --washlet-accent: var(--primary-color); --washlet-water: #2f9be0; --washlet-front: #d96aa6; --washlet-dry: #e0a12f; }
  ha-card { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  button {
    font: inherit; color: inherit; background: none; border: none; cursor: pointer; padding: 0;
    -webkit-tap-highlight-color: transparent; position: relative;
  }
  button:focus-visible { outline: 2px solid var(--washlet-accent); outline-offset: 2px; }
  ha-icon { --mdc-icon-size: 20px; }
  code { font-size: 12px; }

  .message { display: flex; align-items: center; gap: 12px; color: var(--secondary-text-color); line-height: 1.4; }

  .header { display: flex; align-items: center; gap: 12px; }
  .badge {
    width: 42px; height: 42px; border-radius: 50%; flex: none; display: grid; place-items: center;
    background: color-mix(in srgb, var(--washlet-accent) 14%, transparent); color: var(--washlet-accent);
    transition: background 0.3s;
  }
  .badge.on { animation: ripple 2s ease-out infinite; }
  .badge ha-icon { --mdc-icon-size: 22px; }
  .titles { flex: 1; min-width: 0; }
  .title { font-size: 16px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .subtitle { font-size: 13px; color: var(--secondary-text-color); }
  .stop {
    display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px 9px 12px; border-radius: 22px;
    background: var(--error-color, #db4437); color: #fff; font-weight: 500; font-size: 14px;
  }

  .primary-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 10px; }
  .primary-row.dim { opacity: 0.5; }
  .primary {
    --tone: var(--washlet-water);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    min-height: 84px; border-radius: 16px; font-size: 14px; font-weight: 500;
    border: 1px solid var(--divider-color); transition: background 0.25s, border-color 0.25s, box-shadow 0.25s;
  }
  .primary ha-icon { --mdc-icon-size: 28px; color: var(--tone); }
  .primary.front { --tone: var(--washlet-front); }
  .primary.dry { --tone: var(--washlet-dry); }
  .primary:hover { border-color: var(--tone); }
  .primary.active {
    border-color: var(--tone); box-shadow: 0 0 0 1px var(--tone) inset;
    background: color-mix(in srgb, var(--tone) 12%, var(--card-background-color));
  }

  .section { display: flex; flex-direction: column; gap: 10px; }
  .stepper { display: flex; align-items: center; gap: 10px; }
  .step {
    width: 44px; height: 44px; border-radius: 12px; flex: none; display: grid; place-items: center;
    background: var(--secondary-background-color);
  }
  .step-label { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 13px; color: var(--secondary-text-color); }
  .dots { display: flex; gap: 5px; }
  .dots i { width: 22px; height: 6px; border-radius: 3px; background: var(--divider-color); transition: background 0.2s; }
  .dots i.lit { background: var(--washlet-water); }
  .dots.idle { opacity: 0.6; }

  .pills { display: flex; gap: 8px; flex-wrap: wrap; }
  .pill {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 12px;
    border-radius: 20px; font-size: 13px; border: 1px solid var(--divider-color);
  }
  .pill:hover { border-color: var(--washlet-accent); }

  .extras {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px;
    padding-top: 14px; border-top: 1px solid var(--divider-color);
  }
  .tile {
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 12px;
    font-size: 11.5px; color: var(--secondary-text-color); background: var(--secondary-background-color);
  }
  .tile ha-icon { color: var(--primary-text-color); }

  button.sent::after {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    animation: sent 0.6s ease-out;
  }

  @keyframes sent {
    from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--washlet-accent) 55%, transparent); background: color-mix(in srgb, var(--washlet-accent) 18%, transparent); }
    to { box-shadow: 0 0 0 10px transparent; background: transparent; }
  }
  @keyframes ripple {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--washlet-water) 35%, transparent); }
    100% { box-shadow: 0 0 0 12px transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .badge.on, button.sent::after { animation: none; } }
`;

// ------------------------------------------------------------------ editor

const EDITOR_SCHEMA = [
  { name: "remote", selector: { entity: { domain: "remote" } } },
  { name: "device", selector: { text: {} } },
  { name: "name", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_adjust", selector: { boolean: {} } },
      { name: "show_extras", selector: { boolean: {} } },
      { name: "show_levels", selector: { boolean: {} } },
    ],
  },
  {
    name: "hide",
    selector: {
      select: {
        multiple: true,
        mode: "dropdown",
        options: Object.entries(COMMANDS).map(([value, { label }]) => ({ value, label })),
      },
    },
  },
];

const EDITOR_LABELS = {
  remote: "IR remote entity",
  device: "Device name (for learned commands)",
  name: "Card name",
  show_adjust: "Pressure & position",
  show_extras: "Extra functions",
  show_levels: "Show estimated levels",
  hide: "Hide buttons your model doesn't have",
};

const EDITOR_HELPERS = {
  device: "Broadlink: the device name used with remote.learn_command (e.g. toto).",
};

class TotoWashletCardEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  async connectedCallback() {
    // ha-form is lazy-loaded by HA; loading a built-in card editor guarantees it exists.
    if (!customElements.get("ha-form")) {
      try {
        const helpers = await window.loadCardHelpers?.();
        const card = await helpers?.createCardElement({ type: "entities", entities: [] });
        await card?.constructor?.getConfigElement?.();
      } catch (_err) {
        /* best effort */
      }
    }
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] ?? schema.name;
      this._form.computeHelper = (schema) => EDITOR_HELPERS[schema.name];
      this._form.addEventListener("value-changed", (ev) => {
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: ev.detail.value },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = {
      show_adjust: true,
      show_extras: true,
      show_levels: true,
      ...this._config,
    };
  }
}

if (!customElements.get("toto-washlet-card"))
  customElements.define("toto-washlet-card", TotoWashletCard);
if (!customElements.get("toto-washlet-card-editor"))
  customElements.define("toto-washlet-card-editor", TotoWashletCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "toto-washlet-card")) {
  window.customCards.push({
    type: "toto-washlet-card",
    name: "TOTO Washlet Card",
    description: "IR remote for TOTO Washlet bidets: wash, dry, pressure, position and more.",
    preview: true,
    documentationURL: "https://github.com/sabourinj/ha-toto-washlet-card",
  });
}

console.info(
  `%c TOTO-WASHLET-CARD %c v${CARD_VERSION} `,
  "color:#fff;background:#2f9be0;font-weight:700;border-radius:3px 0 0 3px",
  "color:#2f9be0;background:#e8f4fc;border-radius:0 3px 3px 0"
);
