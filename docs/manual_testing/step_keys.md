# Testing the step keys

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The Brightness Up, Brightness Down, Temperature Up and Temperature Down keys step the lamps by their step, for decks without dials ([#129]). A press is a dial's tick: it goes through the same operation, so the lamps stop on the same values and within their caps, and presses as quick as a dial's ticks move them once. The unit tests check against a fake Stream Deck which way and by how much each key asks the lamps to move, and what each key shows as its title. The integration tests check against emulated lamps that the lamps move, stop at their caps, and that every step key follows a change. The checks below cover what they take for granted: that Stream Deck offers the actions with their icons and images, shows their settings pages and passes on their settings, draws the titles the plugin sets, and that the lamps follow. Every connected lamp is managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## When to run these checks

- After a change to how the plugin steps the lamps, to the step keys' settings pages, titles or images.
- After a Stream Deck update.

## Setup

Plug two Beams into a Stream Deck + XL's USB hub, so each has its own cap below 100%. Place the four step keys with their default steps, a Brightness dial, a Temperature dial and a Scene key set to 20% and 4200 K, below every cap measured on a hub. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both. After a change to `manifest.json`, such as the one that added the actions, quit and reopen Stream Deck instead of restarting the plugin.

## Checks

1. **The actions are offered.** Under Litra, the actions list offers "Brightness Up" and "Brightness Down", with a sun with a plus or a minus cut out of it, and "Temperature Up" and "Temperature Down", with a thermometer with a plus or a minus beside it. Each key shows its image, the same size as the Brightness and Temperature keys', and what the lamps are at as its title: the brighter lamp's %, or the temperature in kelvin.
2. **The settings pages.** Selecting a Brightness Up or Down key shows a Step slider from 1% to 25%, at 10%, with its value next to it. Selecting a Temperature Up or Down key shows a Step K list of 100, 200, 300 and 500, at 300.
3. **A press steps the lamps.** Press the Scene key, then Brightness Up: both lamps go to 30%, and both Brightness keys and the Brightness dial show 30%. Press Brightness Down: they go back to 20%. Do the same with Temperature Up and Down: 4500 K, then 4200 K, on both Temperature keys and the dial. The temperature steps along the multiples of the step from the lowest a lamp allows, 2700 K, as a dial's turn does.
4. **The caps hold.** Press Brightness Up until the lamps stop getting brighter: each stops at its cap, and the Brightness keys show the brighter lamp's cap, as the dial does. One more press changes nothing.
5. **Quick presses all count.** Press the Scene key, then Brightness Up three times as fast as you can: the lamps end at 50%. `logs/litra.log` has `Brightness Up: Key pressed` lines whose steps add up to 3. Presses within 60 ms of each other, as a dial's ticks are, are gathered into one line, and slower ones each get their own.
6. **A custom title wins.** Give a step key a title of its own in its settings: the key shows it, and keeps showing it after a press. Clear it, and the key shows the lamps' value again after the next change.
7. **An alert shows when no lamp answers.** Unplug both lamps and press a step key: the key shows an alert, then a dash as its title. If the dash covers the alert straight away, note it in [the SDK notes on keys][keys].
8. **The log tells the press and each lamp.** `logs/litra.log` has a line per press, scoped by the key (`Brightness Up`, `Temperature Down`, …), with the presses and the step, then the lines of `adjust brightness` or `adjust temperature` for each lamp.

[#129]: https://github.com/daczarne/streamdeck-litra/issues/129
[contributing]: ../contributing.md
[keys]: ../elgato_sdk/keys.md
