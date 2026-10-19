# Testing the lamp picker

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Every key's settings page has a Lamps item, where the key's lamps are picked ([#20]): a checkbox for each lamp the plugin finds, with an Identify button that blinks it, and one for every lamp. The unit tests check against a fake Stream Deck that each key acts on and shows its own lamps, and against emulated lamps that the plugin lists them by id and blinks the one asked for. The browser tests check the page in a headless Chrome, with a fake standing in for Stream Deck and the plugin: what it lists, what each checkbox saves, a saved lamp that isn't found, and the messages Find lamps and Identify send. The checks below cover what they take for granted: that Stream Deck carries the page's messages to the plugin and back, draws the picker legibly in its panel, and passes on what it saves, and that the lamps follow.

## When to run these checks

- After a change to the lamp picker (`ui/lamp-picker.js` or `src/actions/lamp-picker.ts`), to how a key reads its lamps, or to how the plugin finds the lamps.
- After a Stream Deck update, or an update of the vendored sdpi-components.

## Setup

Plug in two Beams, turned on at different brightness. Place two Power keys and a Brightness Up key on the Deck, and a Brightness dial. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **The picker lists the lamps.** Select a Power key. Under its mode, the Lamps item shows a Find lamps button, then "Beam - " followed by the last 4 characters of its serial number for each lamp, each with an Identify button, then an All checkbox. A key set up before lamps could be picked has every box checked. Share a screenshot of the panel.
2. **Identify blinks the lamp.** Press Identify next to the first lamp: that lamp goes off for a moment and comes back at the same brightness. The other one doesn't change. The order and the names match the dial's lamp screens: the first lamp listed is "1 of 2" there, under the same label.
3. **A key acts on its lamps.** Uncheck the second lamp: All unchecks too. Press the key: only the first lamp toggles. The other Power key, still on All, toggles both.
4. **A key shows its lamps' state.** Turn the second lamp off with the other Power key, then the first lamp on with this one: this key shows on, and the other key, on All, shows off.
5. **A step key steps and shows its lamps.** Pick only the second lamp on the Brightness Up key: its title shows the second lamp's %. Press it: only the second lamp brightens.
6. **All takes every lamp back.** Check the second lamp again on the first Power key: both lamps are checked, and All stays unchecked, since All also takes in lamps plugged in later and the two lamps don't ([#147]). Check All: every lamp stays checked. Press the key: both lamps toggle.
7. **No lamp is no action.** Uncheck All: every lamp unchecks. Press the key: it shows an alert, and the lamps don't change.
8. **A lamp that isn't plugged in stays listed.** Pick only the second lamp on a Power key, unplug that lamp, and select the key again: the second lamp is still listed, checked, with "not found" in place of its button. Press the key: it shows an alert. Plug the lamp back in and press Find lamps: it's listed with its Identify button again, still checked.
9. **The selection survives a restart.** Restart the plugin, then quit and reopen Stream Deck: every key still shows the lamps it was given, and acts on them.
10. **Dials have no picker.** Select the Brightness dial: its settings page shows its step, and no Lamps item.
11. **The log tells the page and each press.** `logs/litra.log` has a `Lamp picker` line each time a key's page opens or Find lamps is pressed, and one for each Identify. Each key press names the lamps it acts on: "on every lamp", or "on 1 lamp".

[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#147]: https://github.com/daczarne/streamdeck-litra/issues/147
