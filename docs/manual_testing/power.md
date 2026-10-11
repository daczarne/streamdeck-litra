# Testing power

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check against fake lamps how a toggle chooses one state for every lamp: off if every lamp is on, on otherwise ([#23]). The checks below cover what they take for granted: that the lamps report their state and follow the command, and that the Power key and the dials press through to the same toggle. Every connected lamp is managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## When to run these checks

- After a change to how the plugin turns the lamps on or off, or reads whether they're on.
- After a Stream Deck update.

## Setup

Plug in both Beams. Place a Power key in its default toggle mode, a Brightness dial and a Temperature dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

To put the lamps out of sync, turn one Beam off with its own power button. The plugin doesn't notice a lamp's own button, so the Power key keeps showing what it showed before until it's pressed.

## Checks

1. **The key brings lamps out of sync together.** Turn both lamps on, then one off with its button. Press the Power key: both lamps turn on, and the key shows on.
2. **The key turns lamps in sync off.** Press the Power key again: both lamps turn off, and the key shows off. Press it once more: both turn on.
3. **A dial press brings lamps out of sync together.** Turn one lamp off with its button. Press the Brightness dial: both lamps turn on. Turn one off again and press the Temperature dial: both lamps turn on.
4. **A dial press turns lamps in sync off.** With both lamps on, press either dial: both lamps turn off. Press it again: both turn on.

[#23]: https://github.com/daczarne/streamdeck-litra/issues/23
[contributing]: ../contributing.md
