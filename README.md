# TOTO Washlet Card

A Lovelace remote control for **TOTO Washlet** smart bidets in Home Assistant.

![TOTO Washlet Card screenshot](https://raw.githubusercontent.com/sabourinj/ha-toto-washlet-card/main/docs/screenshot.png)

Washlets are controlled by an **infrared remote** and send nothing back. This card is the button layout: each button sends a named IR command through whatever blaster you already have in Home Assistant.

- **Broadlink (or any `remote` entity)**: learn your Washlet remote's codes under names like `rear` and `pressure_up`, and the card sends them with `remote.send_command`.
- **ESPHome, scripts, buttons**: map any button to an entity or action, such as `rear: button.toto_rear`.

## Features

- Large **Rear / Front / Dry** buttons and a prominent **Stop** button.
- **Pressure** and **Position** steppers with level indicators.
- **Oscillate** and **Pulsate** buttons.
- **Extras**: water, seat and dryer temperature, deodorize, flush, lid, seat, and User 1 / User 2 presets.
- Hide any button your model doesn't have.
- Brief "sent" feedback on every press, a visual editor, theme-aware colors, and support for the sections-view grid.

> **About the level indicators:** IR is one-way, so the card can't read the bidet's actual settings. It estimates them: starting a wash resets pressure and position to your defaults (3 of 5), as a Washlet does, and +/- moves from there. Turn the indicators off with `show_levels: false` if you'd rather not see an estimate.

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) → **Custom repositories**.
2. Add `https://github.com/sabourinj/ha-toto-washlet-card` with type **Dashboard**.
3. Search for **TOTO Washlet Card**, install it, then reload your browser.

### Manual

1. Copy `dist/toto-washlet-card.js` to `<config>/www/toto-washlet-card.js`.
2. Go to **Settings → Dashboards → ⋮ → Resources** and add `/local/toto-washlet-card.js` as a **JavaScript module**.

## Setting up IR

### Option A: Broadlink (learned codes)

Learn each button from your Washlet remote under the device name `toto`, using the command names the card expects. Run this from **Developer tools → Actions**, then press the matching remote button each time the Broadlink light comes on:

```yaml
action: remote.learn_command
target:
  entity_id: remote.bathroom_ir
data:
  device: toto
  command:
    - stop
    - rear
    - front
    - dry
    - pressure_up
    - pressure_down
    - position_forward
    - position_back
    - oscillate
    - pulsate
```

Learn the extras the same way if your model has them: `water_temp`, `seat_temp`, `dryer_temp`, `deodorize`, `flush`, `lid`, `seat`, `user_1`, `user_2`.

Then the card config is just:

```yaml
type: custom:toto-washlet-card
remote: remote.bathroom_ir
device: toto
```

If you already learned codes under other names, map them with `commands:` instead of re-learning (see below).

### Option B: ESPHome IR blaster

ESPHome supports TOTO's IR protocol natively through [`remote_transmitter.transmit_toto`](https://esphome.io/components/remote_transmitter/). Create a template button for each function, and HA turns each one into a `button` entity:

```yaml
button:
  - platform: template
    name: "TOTO Rear"
    on_press:
      - remote_transmitter.transmit_toto:
          command: 0x00   # replace with the code captured from your remote
```

To find your codes, add a `remote_receiver` with `dump: all`, point your Washlet remote at it, and read the Toto codes from the ESPHome logs. Then map the buttons:

```yaml
type: custom:toto-washlet-card
name: Primary Bath
actions:
  stop: button.toto_stop
  rear: button.toto_rear
  front: button.toto_front
  dry: button.toto_dry
  pressure_up: button.toto_pressure_up
  pressure_down: button.toto_pressure_down
  position_forward: button.toto_position_forward
  position_back: button.toto_position_back
```

## Configuration

| Option             | Type    | Default    | Description                                                                 |
| ------------------ | ------- | ---------- | --------------------------------------------------------------------------- |
| `remote`           | entity  |            | `remote.*` entity used for `remote.send_command`.                           |
| `device`           | string  |            | Device name passed to `remote.send_command` (Broadlink learned-code group). |
| `name`             | string  | `Washlet`  | Card title.                                                                 |
| `icon`             | string  | `mdi:toilet` | Header icon.                                                              |
| `show_adjust`      | boolean | `true`     | Show the pressure/position steppers and the oscillate/pulsate buttons.     |
| `show_extras`      | boolean | `true`     | Show the extra function tiles.                                             |
| `show_levels`      | boolean | `true`     | Show the estimated pressure/position indicators.                           |
| `default_pressure` | number  | `3`        | Estimated pressure (1–5) when a wash starts.                               |
| `default_position` | number  | `3`        | Estimated position (1–5) when a wash starts.                               |
| `hide`             | list    | `[]`       | Command keys to hide, e.g. `[flush, lid, seat]`.                           |
| `commands`         | map     |            | Rename the learned command sent for a key, e.g. `rear: toto_rear_wash`.    |
| `actions`          | map     |            | Send a key through an entity or action instead of the remote (see below).  |
| `labels` / `icons` | map     |            | Override a button's label or icon, e.g. `front: Bidet`.                    |
| `num_repeats`      | number  |            | Passed to `remote.send_command`.                                           |
| `delay_secs`       | number  |            | Passed to `remote.send_command`.                                           |

**Command keys:** `stop`, `rear`, `front`, `dry`, `pressure_up`, `pressure_down`, `position_forward`, `position_back`, `oscillate`, `pulsate`, `water_temp`, `seat_temp`, `dryer_temp`, `deodorize`, `flush`, `lid`, `seat`, `user_1`, `user_2`.

### `actions` values

Each entry in `actions:` can be:

```yaml
actions:
  rear: button.toto_rear            # entity: button/input_button → press, script/scene → turn_on
  front: toto_front_wash            # plain name → sent as a remote command
  user_1:                           # any action
    action: esphome.bathroom_ir_send_toto
    data:
      command: 0x00
```

You can combine the two methods: set `remote:` for most buttons and use `actions:` for the few that work differently.

## License

MIT
