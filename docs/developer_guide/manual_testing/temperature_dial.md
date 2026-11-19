# Testing the temperature dial

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check how the Set Temperature dial steps, against emulated lamps, from the highest temperature, and that every temperature dial follows each change to the lamps, against a fake Stream Deck. The integration tests check that the dial shows the highest temperature of lamps set apart, with its bar banded by how many lamps reach each part of it ([#229]). They also check that a quick turn moves the lamps once, with the step the dial has by then. The checks below cover what they take for granted: that Stream Deck lists every dial of the action and passes on each dial's step, and that the touch strip shows what the plugin sends it. From its main screen, every connected lamp is managed as one group (see "By default, lamps are managed together" in [the contributing guide][contributing]). Lamps kept apart by the global setting are checked in [`lamps_apart.md`][lamps-apart].

## When to run these checks

- After a change to how the plugin sets temperature, to how the dial steps, to whether a change turns the lamps on, to what the dials show, or to the action's images.
- After a Stream Deck update.

## Setup

Plug in two Beams. Place two Set Temperature dials and two Set Temperature keys on the Deck, one key set to 3000 K and the other to 6000 K, and leave the dials' step at its default, 300 K, which the checks below count on. Leave both "Each lamp steps from its own" checkboxes unchecked in the plugin settings, their default, so the lamps step together (see [`lamps_apart.md`][lamps-apart]). Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **A key moves the dials to its temperature.** Press the 3000 K key. Both lamps turn warm, and both strips show 3000 K. Press the 6000 K key: both lamps turn cool, and both strips show 6000 K.
2. **Every dial shows the same.** Turn one dial a few steps either way. After each step, the other dial shows the same value as the one turned.
3. **The keys keep their presets.** After checks 1 and 2, each key still shows its own preset, not the dials' value.
4. **Going down retraces going up.** Set one dial's step to 500 in its settings. Press the 3000 K key, then turn that dial up one step at a time: the strips show 3200 K, 3700 K, and so on up to 6200 K, then 6500 K. Turn it down one step at a time: 6200 K, 5700 K, and so on down to 3200 K, then 2700 K, the same temperatures as on the way up ([#16]). Set the step back to 300.
5. **The dial says what it does.** Both strips show "Set Temperature" at the top, above the icon and the value. If a strip shows none, check **Show Title** under the **T** menu of the dial's settings, which Stream Deck keeps for each dial. A title typed in the title field replaces it.
6. **The keys and the app's dial pictures show the strip's icon.** In the Stream Deck app, the round picture of each Set Temperature dial shows the white line thermometer from its touch strip ([#51]). So does a Set Temperature key or dial newly dragged onto the Deck. A key or dial given a custom image keeps it.
7. **The dials show the highest temperature, and the bar shows every lamp.** On one dial's lamp screens, set the first lamp to 3300 K and the second to 4500 K, and tap back to its main screen: both strips show 4500 K, and each bar is white up to 3300 K, about a sixth of the way, and light grey from there to 4500 K, about halfway, with a sharp edge between them ([#229]). Switch to another page of the Deck and back a few times: the strips still show 4500 K and the same bar each time they appear. Turn a dial one step up: both lamps go to 4800 K, a step of 300 K up from the highest temperature the strips showed, and the bar turns plain white.
8. **A Beam LX turns on at the temperature it was given while off.** With a Beam LX plugged in as well, tap a dial's strip to the Beam LX's screen, set it to 3000 K, push the dial to turn the lamp off, and wait a few seconds. Turn the dial to 5000 K, and push it again: the lamp turns on at 5000 K, and its screen shows it. Turn it off again, set 4000 K, and turn it on with a Power key: it turns on at 4000 K. A Beam LX turns on at the setting it had when switched off, so the plugin puts back the one it was given: `logs/litra.log` has a `turned on at` line for each, with the temperature it was put back to ([#100]).
9. **An unplugged lamp leaves the dial quiet.** Unplug one Beam, then turn a dial on its main screen, and push it: the other lamp moves, then toggles, and the strip doesn't flash red. Press the 3000 K key: the other lamp turns warm, and the key shows an alert, since one of its lamps isn't connected. Plug the lamp back in.
10. **The plugin settings turn the lamps on.** Push a dial to turn both lamps off. Press the 3000 K key, and turn a dial: the lamps stay off, and the strips follow. In the plugin settings, check "Set Temperature keys turn lamps on", under "Keys", and press the 6000 K key: both lamps turn on. Turn them off again, check "Set Temperature dials turn lamps on", under "Main screen", and turn a dial: both lamps turn on. Turn them off again, check "Set Temperature dials turn the lamp on", under "Lamp screens", tap a dial's strip to the first lamp's screen, and turn it: that lamp turns on, and the other one stays off ([#268]). Uncheck the three.

[#16]: https://github.com/daczarne/streamdeck-litra/issues/16
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#100]: https://github.com/daczarne/streamdeck-litra/issues/100
[#229]: https://github.com/daczarne/streamdeck-litra/issues/229
[#268]: https://github.com/daczarne/streamdeck-litra/issues/268
[contributing]: ../../contributing.md
[lamps-apart]: lamps_apart.md
