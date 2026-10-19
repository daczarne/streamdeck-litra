# Stream Deck keys

- [What a key shows](#what-a-key-shows)
- [States](#states)
- [Alerts](#alerts)
- [Sources](#sources)

An action placed on a key draws its picture from the manifest, and the plugin can change it while the key is on the Deck. This document lists what the plugin can set on a key, and what Stream Deck does with it, so that what a key shows can be designed around how Stream Deck draws it.

## What a key shows

A key shows an image and a title, which the plugin sets with `setImage` and `setTitle` on the key's action. Both only apply while the user hasn't set their own in the key's settings: a custom image or title always wins. A custom title stays whatever the plugin sets meanwhile, as on a step key whose title turns to a dash when the lamps are unplugged, and the key shows the plugin's title again once the custom one is cleared. `setImage` and `setTitle` without an argument go back to the manifest's.

On top of that, the plugin can show one of two temporary overlays: `showAlert`, an exclamation mark in a yellow triangle, and `showOk`, a check mark in a green circle. The plugin decides when one is shown, and Stream Deck when it goes away.

## States

An action with two states in the manifest (`States`) has an image and a title per state, and `setState` switches between them. Two is the limit: `setState` takes 0 or 1.

By default, Stream Deck switches a key to its other state on every press, before the plugin has done anything. `DisableAutomaticStates: true` in the manifest turns that off, so the key only shows the state the plugin sets. The Power action uses it, since its state follows the lamps, not the presses.

## Alerts

**A state set right after an alert covers it.** When the plugin calls `setState` on a key just after `showAlert`, Stream Deck draws the state over the alert, even when the state doesn't change. A key pressed fast enough shows the alert for an instant, and otherwise not at all. This was seen on the Power key, which sets its state from the lamps after every operation, the failed ones included. To keep the alert visible, the plugin shows it after the state: an alert shown right after `setState` stays. The Power key shows a failed press's alert once its state is redrawn ([#132]).

**A title set right after an alert doesn't.** The step keys set their title from the lamps after every operation too, and their alert shows in full, with the new title, such as a dash when no lamp answers, drawn under it straight away. Whether `setImage` covers an alert hasn't been checked. A dial's alert, a red flash of its part of the strip, showed in full while the dial went back to its main screen (see [the notes on layouts][layouts]). Either way, the logs say why a key failed (see [the logging document][logging]).

## Sources

Checked against `@elgato/streamdeck` 3.0.1 and the manifest schema in `@elgato/schemas`, both installed in `node_modules/`, and on Stream Deck 7.6:

- `setImage`, `setState`, `setTitle`, `showAlert` and `showOk`: `@elgato/streamdeck/dist/plugin/actions/key.d.ts`.
- `States` and `DisableAutomaticStates`: the `Action` definition in `@elgato/schemas/streamdeck/plugins/manifest.json`.
- An alert covered by a state, and one that a title doesn't cover: seen on the Deck, pressing a Power key and a step key with no lamp connected.
- An alert that a state set before it doesn't cover: seen on the Deck, pressing a Power key with the lamps unplugged while on.
- A custom title that stays: seen on the Deck, on a step key with no lamp connected.

[#132]: https://github.com/daczarne/streamdeck-litra/issues/132
[layouts]: layouts.md
[logging]: ../logging.md
