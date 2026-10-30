# Testing the plugin settings

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Every settings page, on a key or a dial, has a Plugin settings button at its top, which shows the plugin's own settings in place of the action's ([#146]): a Find lamps button, then a table of the lamps the plugin finds, each by the end of its serial number and its model, with a field for its name and an Identify button that blinks it, then the global settings every dial and key shares, such as "Each lamp" (see [`lamps_apart.md`][lamps-apart]). The names are saved to the plugin's global settings, and the keys' lamp pickers show them (see [`lamp_picker.md`][lamp-picker]). The unit tests check against emulated lamps that the plugin lists each lamp with its model and the end of its serial, and blinks the one asked for. The browser tests check every page in a headless Chrome, with a fake standing in for Stream Deck and the plugin: the button, that the plugin settings take the action's place and give it back, the table, what a name saves, and the messages Find lamps and Identify send. The checks below cover what they take for granted: that Stream Deck draws the button and the table legibly in its panel, carries the page's messages to the plugin and back, and keeps the names, and that the lamps follow.

## When to run these checks

- After a change to the plugin settings (`ui/plugin-settings.js`), to the lamp picker's names (`ui/lamp-picker.js`), or to how the plugin finds or blinks the lamps.
- After a Stream Deck update, or an update of the vendored sdpi-components.

## Setup

Plug in two Beams, turned on. Place a Power key and a Brightness dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **Every page has the button.** Select the Power key, then the Brightness dial: each page shows a Plugin settings button first, under the title, as wide as the controls below it. Share a screenshot of each panel.
2. **The plugin settings take the page.** Press Plugin settings on the Power key: the button reads Back, and under it come Find lamps and a table with ID, Model and Name, and a row for each lamp, such as "7K98", "Beam", an empty name field with "Beam - 7K98" in grey, and Identify. Under the table, "Each lamp" shows its two checkboxes. None of the key's own settings show. The rows come in the order of the dial's lamp screens. Share a screenshot of the panel.
3. **Identify blinks the lamp.** Press Identify on the first row: that lamp goes off for a moment and comes back at the same brightness. The other one doesn't change.
4. **A name is saved, and the picker shows it.** Type "Left" in the first lamp's name. Press Back: the key's settings show again, and its Lamps item lists "Left" in place of the first lamp's label. Select the dial, then the key again: the name is still there.
5. **A name is at most 24 characters.** Type a long name: the field takes 24 characters and no more.
6. **The names are the plugin's.** Open the plugin settings on the dial: they show the same names. Rename the second lamp there, then select the key: its Lamps item shows the new name.
7. **An emptied name gives the label back.** Empty the first lamp's name: the key's Lamps item lists it as "Beam - " and the end of its serial again.
8. **Find lamps lists a lamp plugged in.** Unplug the second lamp, open the plugin settings, and press Find lamps: only the first lamp is listed. Plug it back in and press Find lamps again: it's listed, with its name. Press Back: the key's Lamps item lists it too.
9. **The names survive a restart.** Name both lamps, restart the plugin, then quit and reopen Stream Deck: the plugin settings and the keys' Lamps items still show the names.
10. **The log tells each request.** `logs/litra.log` has a `Lamp picker` line each time the plugin settings open or Find lamps is pressed, and one for each Identify.

[#146]: https://github.com/daczarne/streamdeck-litra/issues/146
[lamp-picker]: lamp_picker.md
[lamps-apart]: lamps_apart.md
