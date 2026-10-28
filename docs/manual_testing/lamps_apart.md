# Testing lamps kept apart

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

By default, a turn on a Brightness or Temperature dial's main screen, and a press of a step key, send every lamp to one value, which brings lamps set apart on their lamp screens back in sync. Two global settings keep them apart instead, one for the brightness and one for the temperature: each lamp then steps from its own value, along the multiples of the step, and one that reaches an end of its range or its cap stays there while the others keep going. The plugin remembers how far such a lamp would have gone, so it comes back with the others and they keep their difference, and once every lamp is at its end, turning further does nothing ([#145]).

The unit tests check against emulated lamps that each lamp steps from its own value, that one at an end or at its cap stays there while the others keep going and comes back with their difference, that turning past every lamp's end does nothing, that the first tick back moves a lamp even after a turn went past caps not learned yet, that a lamp set any other way steps from where it is, and against a fake Stream Deck that the dials' main screens and the step keys follow the setting of what they step, while a lamp screen's turn stays on its lamp. The integration tests check a dial and a step key keeping the brightness apart while the temperature stays together, two lamps a step apart through their caps on a hub, down to 0% and back up, and the lamps coming back in sync once the setting is off. The browser tests check that the Brightness dial's and Brightness step keys' settings pages show the brightness's checkbox, the Temperature ones the temperature's, unchecked by default, and that they save it to the plugin's global settings rather than the action's. The checks below cover what they take for granted: that Stream Deck keeps the global settings and passes them on to the plugin, that the pages show them, and that the lamps follow.

## When to run these checks

- After a change to how the plugin steps the lamps, to the dials' or step keys' settings pages, or to the plugin's global settings.
- After a Stream Deck update.

## Setup

Plug two Beams into the computer, so neither has a cap. Place a Brightness dial, a Temperature dial, a Brightness Up key and a Temperature Up key on the Deck, with the dials' default steps, 10% and 300 K, and the keys' set the same. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

On the Brightness dial's lamp screens, set the first lamp to 30% and the second to 60%. On the Temperature dial's, set the first to 3300 K and the second to 4500 K. Tap each dial back to its main screen.

## Checks

1. **Both are off by default.** Select the Brightness dial in Stream Deck: under "Each lamp", "Steps from its own brightness, on every dial and key" is unchecked. Select the Temperature dial: "Steps from its own temperature, on every dial and key" is unchecked too. Turn each dial one tick up: both lamps go to 70%, and both go to one temperature, 300 K above the one the Temperature dial showed. Set the lamps apart again, as in the setup.
2. **The brightness stays apart on a dial.** Check the setting on the Brightness dial, and turn it one tick up: the first lamp goes to 40% and the second to 70%, and the strip shows 70%, its bar lighter from 40% up. Turn it one tick down: 30% and 60%.
3. **The temperature stays together.** Turn the Temperature dial one tick up: both lamps go to one temperature, 300 K above the one the dial showed, since only the brightness's setting is checked.
4. **The step keys share the setting.** Select the Brightness Up key: the setting is checked there too. Press it: the lamps go to 40% and 70%, and the key shows 70%.
5. **A lamp at the top comes back with its difference.** Press Brightness Up until both lamps are at 100%: the second gets there first and stays, while the first keeps going. Press it twice more: nothing changes. Turn the Brightness dial down one tick at a time: the first lamp comes down while the second stays at 100%, until the first reaches 70%. From there, they come down 30% apart again: 60% and 90%.
6. **A lamp set another way steps from where it is.** Press Brightness Up twice: 80% and 100%, the second held at the top. On the second lamp's screen, turn the dial one tick down and one tick up, back to 100%, and tap back to the main screen. Turn the main screen down one tick: both lamps move, to 70% and 90%, since the turns on its screen made the second lamp step from where it is.
7. **The temperature has its own setting.** On the Temperature dial's lamp screens, set the first lamp to 3300 K and the second to 4500 K again, and tap back to its main screen. Select the Temperature Up key, and check its setting: the Temperature dial's page shows it checked too, and the brightness's stays as it was. Press Temperature Up: each lamp goes one step of 300 K up from its own temperature, 3600 K and 4800 K.
8. **Through the caps and down to 0%.** Plug both lamps into the Stream Deck + XL's hub, and restart the plugin, so it learns their caps afresh. On the Brightness dial's lamp screens, set the first lamp to 10% and the second to 0%, and tap back to the main screen. Turn the dial up one tick at a time until neither lamp changes: each stops at its own cap. Turn it up 3 more ticks: nothing changes. Turn it down one tick at a time: the first tick moves a lamp, and each lamp leaves its cap on the tick that mirrors the one that took it there, and from there on the lamps are 10% apart, down to 10% and 0%. Turn it down once more: the first lamp goes to 0%. Turn it down 3 more ticks: nothing changes. Turn it up one tick: the first lamp goes to 10%, and the second stays at 0%. Restart the plugin, so it forgets the caps, and turn the dial up quickly, several ticks at once, until both lamps are at their caps: the first tick down moves a lamp.
9. **The settings outlast a restart.** Restart the plugin with `npx streamdeck restart com.daczarne.litra`, then quit Stream Deck and open it again. Both settings are still checked, and a turn of either dial still steps each lamp from its own value. Uncheck both to leave the defaults.

[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
