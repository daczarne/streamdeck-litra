# Testing the temperature dial

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check how the Temperature dial steps, against emulated lamps, from the first lamp's temperature, in the order the plugin settings list the lamps, and that every temperature dial follows each change to the lamps, against a fake Stream Deck. The integration tests check that a quick turn moves the lamps once, with the step the dial has by then. The checks below cover what they take for granted: that Stream Deck lists every dial of the action and passes on each dial's step, and that the touch strip shows what the plugin sends it. From its main screen, every connected lamp is managed as one group (see "By default, lamps are managed together" in [the contributing guide][contributing]). Lamps kept apart by the global setting are checked in [`lamps_apart.md`][lamps-apart].

## When to run these checks

- After a change to how the plugin sets temperature, to how the dial steps, to what the dials show, to the order the plugin goes through the lamps in, or to the action's images.
- After a Stream Deck update.

## Setup

Plug in two Beams. Place two Temperature dials and two Temperature keys on the Deck, one key set to 3000 K and the other to 6000 K. Leave both "Each lamp steps from its own" checkboxes unchecked in the plugin settings, their default, so the lamps step together (see [`lamps_apart.md`][lamps-apart]). Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **A key moves the dials to its temperature.** Press the 3000 K key. Both lamps turn warm, and both strips show 3000. Press the 6000 K key: both lamps turn cool, and both strips show 6000.
2. **Every dial shows the same.** Turn one dial a few steps either way. After each step, the other dial shows the same value as the one turned.
3. **The keys keep their presets.** After checks 1 and 2, each key still shows its own preset, not the dials' value.
4. **Going down retraces going up.** Set one dial's step to 500 in its settings. Press the 3000 K key, then turn that dial up one step at a time: the strips show 3200, 3700, and so on up to 6200, then 6500. Turn it down one step at a time: 6200, 5700, and so on down to 3200, then 2700, the same temperatures as on the way up ([#16]). Set the step back to 100.
5. **The dial says what it does.** Both strips show "Temperature" at the top, above the icon and the value. If a strip shows none, check **Show Title** under the **T** menu of the dial's settings, which Stream Deck keeps for each dial. A title typed in the title field replaces it.
6. **The keys and the app's dial pictures show the strip's icon.** In the Stream Deck app, the round picture of each Temperature dial shows the white line thermometer from its touch strip ([#51]). So does a Temperature key or dial newly dragged onto the Deck. A key or dial given a custom image keeps it.
7. **The dials show the first lamp's temperature.** On one dial's lamp screens, set the first lamp to 3300 K and the second to 4500 K, and tap back to its main screen: both strips show 3300, the temperature of the lamp the first tap shows, and the first in the plugin settings' list of lamps. Switch to another page of the Deck and back a few times: the strips still show 3300 each time they appear. Turn a dial one step up: both lamps go to 3400, stepped from the first lamp.
8. **A Beam LX turns on at the temperature it was given while off.** With a Beam LX plugged in as well, tap a dial's strip to the Beam LX's screen, set it to 3000 K, push the dial to turn the lamp off, and wait a few seconds. Turn the dial to 5000 K, and push it again: the lamp turns on at 5000 K, and its screen shows it. Turn it off again, set 4000 K, and turn it on with a Power key: it turns on at 4000 K. A Beam LX turns on at the setting it had when switched off, so the plugin puts back the one it was given: `logs/litra.log` has a `turned on at` line for each, with the temperature it was put back to ([#100]).
9. **An unplugged lamp leaves the dial quiet.** Unplug one Beam, then turn a dial on its main screen, and push it: the other lamp moves, then toggles, and the strip doesn't flash red. Press the 3000 K key: the other lamp turns warm, and the key shows an alert, since one of its lamps isn't connected. Plug the lamp back in.

[#16]: https://github.com/daczarne/streamdeck-litra/issues/16
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#100]: https://github.com/daczarne/streamdeck-litra/issues/100
[contributing]: ../contributing.md
[lamps-apart]: lamps_apart.md
