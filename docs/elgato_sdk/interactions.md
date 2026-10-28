# Stream Deck + dial interactions

- [Interactions](#interactions)
- [What the SDK doesn't offer](#what-the-sdk-doesnt-offer)
- [Interaction descriptions](#interaction-descriptions)
- [Sources](#sources)

A dial on the Stream Deck + comes with its own segment of the touch strip, and an action placed on it receives the interactions with both. This document lists those interactions as the Stream Deck SDK exposes them, so that a dial's behavior can be designed around what is actually there. "Interaction" is Elgato's word, from the manifest schema.

## Interactions

| Interaction                      | Name in the manifest | Event                          | Handler in `SingletonAction` |
|----------------------------------|----------------------|--------------------------------|------------------------------|
| Rotate the dial                  | `Rotate`             | `dialRotate`, `pressed: false` | `onDialRotate`               |
| Rotate the dial while pushing it | None                 | `dialRotate`, `pressed: true`  | `onDialRotate`               |
| Push the dial                    | `Push`               | `dialDown`, then `dialUp`      | `onDialDown`, `onDialUp`     |
| Tap the touch strip              | `Touch`              | `touchTap`, `hold: false`      | `onTouchTap`                 |
| Hold the touch strip             | `LongTouch`          | `touchTap`, `hold: true`       | `onTouchTap`                 |

Details of each event's payload:

- `dialRotate` carries `ticks`, the number of steps turned (positive clockwise, negative counter-clockwise), and `pressed`, which says whether the dial was pushed in while it turned. The manifest has no description for turning while pushed, so the app can't show what it does. The type definitions don't say whether such a turn also delivers `dialDown` and `dialUp` around it, so check that on the Deck before giving a dial both a push and a pushed turn.
- `dialDown` and `dialUp` carry no information beyond the action's settings and position.
- `touchTap` carries `hold`, which tells a tap from a long touch, and `tapPos`, the `[x, y]` coordinates of the touch on the action's segment of the strip.

## What the SDK doesn't offer

- **A long press of the dial.** There is no event for it. A plugin that wants one times it between `dialDown` and `dialUp`, and then has to wait for the release before it knows a push was short, so a short push acts on release instead of on push.
- **Double presses or double taps.** The four events above are the only ones a dial receives.
- **Returning to a previous screen on its own.** A plugin that changes what a dial shows (with `setFeedbackLayout` or `setFeedback`) and wants it to revert after a while runs its own timer.

## Interaction descriptions

Stream Deck shows each interaction's description, as an icon and a short text, when the action is selected in the app. They come from `Encoder.TriggerDescription` in `manifest.json`, which has one optional string for each interaction it names: `Rotate`, `Push`, `Touch` and `LongTouch`. An interaction without a description is still delivered to the plugin. `setTriggerDescription` replaces the descriptions at runtime, for example when the dial switches to a screen where the interactions do something else.

## Sources

Checked against `@elgato/streamdeck` 3.0.3 and the manifest schema in `@elgato/schemas`, both installed in `node_modules/`:

- The events and their payloads: `@elgato/streamdeck/dist/api/events/encoder.d.ts`.
- `setFeedbackLayout` and `setTriggerDescription`: `@elgato/streamdeck/dist/plugin/actions/dial.d.ts`.
- `TriggerDescription`: the `Encoder` definition in `@elgato/schemas/streamdeck/plugins/manifest.json`.
