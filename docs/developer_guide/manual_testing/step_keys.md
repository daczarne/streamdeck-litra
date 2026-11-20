# Testing the step keys

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The Brightness Up, Brightness Down, Temperature Up and Temperature Down keys step the lamps by their step, for decks without dials ([#129]). A press is a dial's tick: it goes through the same operation, so the lamps stop on the same values and within their caps, and presses as quick as a dial's ticks move them once. The unit tests check against a fake Stream Deck which way and by how much each key asks the lamps to move, and what each key shows as its title. The integration tests check against emulated lamps that the lamps move, stop at their caps, and that every step key follows a change. The checks below cover what they take for granted: that Stream Deck offers the actions with their icons and images, shows their settings pages and passes on their settings, draws the titles the plugin sets, and that the lamps follow. The keys here act on every connected lamp, as one group: picking a key's lamps is checked in [`lamp_picker.md`][lamp-picker], and lamps kept apart by the global setting in [`lamps_apart.md`][lamps-apart].

## When to run these checks

- After a change to how the plugin steps the lamps, to whether a step turns them on, to the step keys' settings pages, titles or images.
- After a Stream Deck update.

## Setup

Plug two Beams into a Stream Deck + XL's USB hub, so each has its own cap below 100%. Place the four step keys and leave their steps at their defaults, 10% for Brightness Up and Down and 300 K for Temperature Up and Down, which the checks below count on. Place a Brightness dial, a Temperature dial and a Scene key set to 20% and 4200 K, below every cap measured on a hub. Leave both "Each lamp steps from its own" checkboxes unchecked in the plugin settings, their default, so the lamps step together (see [`lamps_apart.md`][lamps-apart]). Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both. After a change to `manifest.json`, such as the one that added the actions, quit and reopen Stream Deck instead of restarting the plugin.

## Checks

1. **The actions are offered.** Under Litra, the actions list offers "Brightness Up" and "Brightness Down", with a sun with a plus or a minus cut out of it, and "Temperature Up" and "Temperature Down", with a thermometer with a plus or a minus beside it. Each key shows its image, the same size as the Set Brightness and Set Temperature keys', and what the lamps are at as its title: the brighter lamp's %, such as "30%", or the temperature with its unit, such as "4200 K".
2. **The settings pages.** Selecting a Brightness Up or Down key shows a Step field from 1% to 25%, at 10%, with − and + on either side. Selecting a Temperature Up or Down key shows a Step K field from 100 K to 500 K in steps of 100 K, at 300 K. Under it, both show a Title value list at Current, offering Current, Next and Step, then the Lamps item (see [`lamp_picker.md`][lamp-picker]), and neither "Each lamp steps from its own" checkbox, which are in the plugin settings (see [`lamps_apart.md`][lamps-apart]).
3. **A press steps the lamps.** Press the Scene key, then Brightness Up: both lamps go to 30%, and both Brightness Up and Down and the Brightness dial show 30%. Press Brightness Down: they go back to 20%. Do the same with Temperature Up and Down: 4500 K, then 4200 K, on both Temperature Up and Down and the Temperature dial. The temperature steps along the multiples of the step from the lowest a lamp allows, 2700 K, as a dial's turn does.
4. **The caps hold.** Press Brightness Up until the lamps stop getting brighter: each stops at its cap, and Brightness Up and Down show the brighter lamp's cap, as the dial does. One more press changes nothing.
5. **Quick presses all count.** Press the Scene key, then Brightness Up three times as fast as you can: the lamps end at 50%, the Scene key's 20% and three steps of 10%. `logs/litra.log` has `Brightness Up: Key pressed` lines whose steps add up to 3. Presses within 60 ms of each other, as a dial's ticks are, are gathered into one line, and slower ones each get their own.
6. **A custom title wins.** Give a step key a title of its own in its settings: the key shows it, and keeps showing it after a press. Clear it, and the key shows the lamps' value again after the next change.
7. **An alert shows when no lamp answers.** Unplug both lamps and press a step key: the key shows an alert, with a dash as its title under it.
8. **The log tells the press and each lamp.** `logs/litra.log` has a line per press, scoped by the key (`Brightness Up`, `Temperature Down`, …), with the presses, the step and the lamps, then the lines of `adjust brightness` or `adjust temperature` for each lamp.
9. **A step leaves the lamps off, unless the plugin settings say otherwise.** Push the Brightness dial to turn both lamps off, and press each step key: the lamps stay off, and the keys and the dials follow every step. In the plugin settings, under "Keys", check "Brightness Up keys turn lamps on", and press Brightness Down: the lamps stay off. Press Brightness Up: both lamps turn on, and its line in `logs/litra.log` ends in `, turning lamps on`. Uncheck it, and do the same with each of the other three keys' checkboxes, one at a time: only the key checked turns the lamps on ([#268]). Uncheck the last one.
10. **A key chooses for itself.** Place a second Brightness Up key. Push the Brightness dial to turn both lamps off. On the first Brightness Up key's page, under "Turn on", check "This key turns lamps on". Its page shows no other "Turn on" checkbox, and a Brightness Down key's page shows its own, unchecked. Press the second Brightness Up key: the lamps stay off. Press the first: both lamps turn on. Open the plugin settings: "Brightness Up keys turn lamps on" shows a bar. Restart the plugin, turn the lamps off, and press the first key again: both lamps turn on. Click the bar: it checks, the first key's own stays checked, and the second key's page now shows its own checked, so it turns the lamps on too. Uncheck "Brightness Up keys turn lamps on" in the plugin settings: both keys' own checkboxes uncheck ([#181]).
11. **A key's title shows what its settings choose.** With both lamps on and stepping together, set Brightness Up's Title value to Next: its title shows the next 10% up from the brighter lamp, such as "60%" from 50%. Press it: the lamps go there, Brightness Down still shows where they are, and Brightness Up shows the next step again. Press it until the brighter lamp stops at its cap: the press after which it falls short shows the step's value, the key then shows the cap, and the lamps stay there on the next press. Set Brightness Down's Title value to Next: it shows where a press down takes the lamps. Set Temperature Up's and Temperature Down's to Step: they show "+300 K" and "−300 K". Change Temperature Up's step to 500 K: it shows "+500 K". Check "Each lamp steps from its own brightness" in the plugin settings, and set the lamps apart on a lamp screen: Brightness Up's and Down's titles show the brighter lamp after each one steps from its own. Uncheck it, and set every Title value back to Current. Share a photo of the keys showing Next and Step.

[#129]: https://github.com/daczarne/streamdeck-litra/issues/129
[#181]: https://github.com/daczarne/streamdeck-litra/issues/181
[#268]: https://github.com/daczarne/streamdeck-litra/issues/268
[lamp-picker]: lamp_picker.md
[lamps-apart]: lamps_apart.md
