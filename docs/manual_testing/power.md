# Testing power

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check against emulated lamps how a toggle chooses one state for every lamp: off if every lamp is on, on otherwise ([#23]). The integration tests check against emulated lamps and a fake Stream Deck that a Brightness dial reaches that toggle, and that the plugin sets the new state on every Power key, whichever key or dial changed the lamps ([#57]). They also check that a failed press shows its alert after the key's state, never before it, since a state set right after an alert covers it. The checks below cover what they take for granted: that the lamps report their state and follow the command, and that Stream Deck shows the state the plugin sets, in a look that tells on from off. The keys here act on every connected lamp, as one group: picking a key's lamps is checked in [`lamp_picker.md`][lamp-picker].

## When to run these checks

- After a change to how the plugin turns the lamps on or off, or reads whether they're on, or to the Power key's images.
- After a Stream Deck update.

## Setup

Plug in two Beams. Place two Power keys in their default toggle mode, a Brightness key, a Brightness dial and a Temperature dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

To put the lamps out of sync, turn one Beam off with its own power button. The plugin doesn't notice a lamp's own button, so the Power keys keep showing what they showed before until the plugin changes the lamps.

## Checks

1. **The key brings lamps out of sync together.** Turn both lamps on, then one off with its button. Press the Power key: both lamps turn on, and the key shows on.
2. **The key turns lamps in sync off.** Press the Power key again: both lamps turn off, and the key shows off. Press it once more: both turn on.
3. **A dial press brings lamps out of sync together.** Turn one lamp off with its button. With both dials on their main screen, press the Brightness dial: both lamps turn on. Turn one off again and press the Temperature dial: both lamps turn on.
4. **A dial press turns lamps in sync off.** With both lamps on, press either dial on its main screen: both lamps turn off. Press it again: both turn on.
5. **Every Power key follows a Power key.** Press one Power key: both lamps change, and both Power keys show the new state.
6. **Every Power key follows a dial press.** Press either dial: both lamps change, and both Power keys show the new state.
7. **Every Power key follows a Brightness key.** With both lamps off, press the Brightness key: both lamps turn on at its preset, and both Power keys show on. Turn the lamps off again and turn the Brightness dial: the same happens.
8. **An alert shows when no lamp answers.** With both lamps on, unplug them, then press a Power key: it shows off, then Stream Deck's alert over it ([#132]). The other Power key shows off, without an alert.
9. **The keys show their state in color.** A Power key shows an orange power symbol when the lamps are on and a grey one when they're off, with nothing drawn behind it, like the transparent icons around it. A key given a custom image keeps it.

[#23]: https://github.com/daczarne/streamdeck-litra/issues/23
[#57]: https://github.com/daczarne/streamdeck-litra/issues/57
[#132]: https://github.com/daczarne/streamdeck-litra/issues/132
[lamp-picker]: lamp_picker.md
