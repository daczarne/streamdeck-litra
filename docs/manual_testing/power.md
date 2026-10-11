# Testing power

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check against fake lamps how a toggle chooses one state for every lamp: off if every lamp is on, on otherwise ([#23]). The checks below cover what they take for granted: that the lamps report their state and follow the command, that the Power key and the dials press through to the same toggle, and that Stream Deck shows the state the plugin sets on every Power key, whichever key or dial changed the lamps ([#57]). Every connected lamp is managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## When to run these checks

- After a change to how the plugin turns the lamps on or off, or reads whether they're on, or to the Power key's images.
- After a Stream Deck update.

## Setup

Plug in both Beams. Place two Power keys in their default toggle mode, a Brightness key, a Brightness dial and a Temperature dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

To put the lamps out of sync, turn one Beam off with its own power button. The plugin doesn't notice a lamp's own button, so the Power keys keep showing what they showed before until the plugin changes the lamps.

## Checks

1. **The key brings lamps out of sync together.** Turn both lamps on, then one off with its button. Press the Power key: both lamps turn on, and the key shows on.
2. **The key turns lamps in sync off.** Press the Power key again: both lamps turn off, and the key shows off. Press it once more: both turn on.
3. **A dial press brings lamps out of sync together.** Turn one lamp off with its button. Press the Brightness dial: both lamps turn on. Turn one off again and press the Temperature dial: both lamps turn on.
4. **A dial press turns lamps in sync off.** With both lamps on, press either dial: both lamps turn off. Press it again: both turn on.
5. **Every Power key follows a Power key.** Press one Power key: both lamps change, and both Power keys show the new state.
6. **Every Power key follows a dial press.** Press either dial: both lamps change, and both Power keys show the new state.
7. **Every Power key follows a Brightness key.** With both lamps off, press the Brightness key: both lamps turn on at its preset, and both Power keys show on. Turn the lamps off again and turn the Brightness dial: the same happens.
8. **The keys show their state without a tile.** A Power key shows an orange power symbol when the lamps are on and a grey one when they're off, both drawn straight on the key's background, like the transparent icons around them. A key given a custom image keeps it.

[#23]: https://github.com/daczarne/streamdeck-litra/issues/23
[#57]: https://github.com/daczarne/streamdeck-litra/issues/57
[contributing]: ../contributing.md
