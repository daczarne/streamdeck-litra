# Testing the plugin settings

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Every settings page, on a key or a dial, has a Plugin settings button at its top, which shows the plugin's own settings in place of the action's ([#146]), in sections by what they reach. "Lamps" has a Find lamps button and a table of the lamps the plugin finds, each by the end of its serial number and its model, with a field for its name and an Identify button that blinks it, then how each lamp steps (see [`lamps_apart.md`][lamps-apart]) and how long a blink lasts ([#171]). "Keys" has whether every key takes in lamps plugged in later (see [`lamp_picker.md`][lamp-picker]). "Dials" has the lamp screens' settings. The names are saved to the plugin's global settings, and the keys' lamp pickers show them (see [`lamp_picker.md`][lamp-picker]). The unit tests check against emulated lamps that the plugin lists each lamp with its model and the end of its serial, and blinks the one asked for, for as long as the global settings say. The browser tests check every page in a headless Chrome, with a fake standing in for Stream Deck and the plugin: the button, that the plugin settings take the action's place and give it back, the table, what a name saves, the messages Find lamps and Identify send, and the blink's slider: its default, its ends, the value it shows, and what it saves. The checks below cover what they take for granted: that Stream Deck draws the button, the sections and their headings, the table, or the message that stands in for it when no lamp is found, and the slider legibly in its panel, carries the page's messages to the plugin and back, and keeps the names and the blink's length, and that the lamps follow.

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
2. **The plugin settings take the page.** Press Plugin settings on the Power key: the button reads Back, and under it comes the "Lamps" heading, with a line under it. Then come Find lamps and a table with ID, Model and Name, and a row for each lamp, such as "7K98", "Beam", an empty name field with "Beam - 7K98" in grey, and Identify. Under the table, "Brightness" and "Temperature" each show a checkbox, and "Blink length" a slider with "400 ms" on its right. Then comes the "Keys" heading, with "New lamps" and its checkbox, "Add new lamps automatically, on every key", checked. Then comes the "Dials" heading, and under it "Lamp screens", centered, with "Blink" and its checkbox, "Layout" with six lists in three rows of two, each with a Configure button under it (see [`lamp_screens.md`][lamp-screens]), and "Text styles", a color, a weight and a size for each of "Primary", "Secondary", "Accent" and "Alert", each with a Reset button under them. None of the key's own settings show. The rows come in the order of the dial's lamp screens. Share a screenshot of the panel.
3. **Identify blinks the lamp.** With both lamps at 0%, press Identify on the first row: that lamp fades to dark, clearly enough to tell even with the other one on, and comes back at the same brightness. The other one doesn't change.
4. **A name is saved, and the picker shows it.** Type "Left" in the first lamp's name. Press Back: the key's settings show again, and its Lamps item lists "Left" in place of the first lamp's label. Select the dial, then the key again: the name is still there.
5. **A name is at most 24 characters.** Type a long name: the field takes 24 characters and no more.
6. **The names are the plugin's.** Open the plugin settings on the dial: they show the same names. Rename the second lamp there, then select the key: its Lamps item shows the new name.
7. **An emptied name gives the label back.** Empty the first lamp's name: the key's Lamps item lists it as "Beam - " and the end of its serial again.
8. **Find lamps lists a lamp plugged in.** Unplug the second lamp, open the plugin settings, and press Find lamps: only the first lamp is listed. Plug it back in and press Find lamps again: it's listed, with its name. Press Back: the key's Lamps item lists it too.
9. **The names survive a restart.** Name both lamps, restart the plugin, then quit and reopen Stream Deck: the plugin settings and the keys' Lamps items still show the names.
10. **The log tells each request.** `logs/litra.log` has a `Lamp picker` line each time the plugin settings open or Find lamps is pressed, and one for each Identify.
11. **The blink's length is the plugin's.** With both lamps at 100%, press Identify: at 400 ms, the lamp only dims part of the way. Drag Blink length to 600 ms, and press Identify: the lamp fades almost to dark, clearly enough to tell even with the other one on. Drag it to 1500 ms: the value next to it follows the slider. Press Identify: the lamp stays dark for a moment before it comes back. Select the Brightness dial, tap its strip to the first lamp's screen, and hold the strip: the lamp blinks just as long. Restart the plugin and press Identify again: still as long, and the slider still shows "1500 ms". Drag it back to 400 ms, to leave the default.
12. **No lamps found stands out.** Unplug both lamps, open the plugin settings, and press Find lamps: "No lamps found" shows centered under Find lamps, in red and in bold, larger than the labels around it, and in the panel's font. Plug the lamps back in and press Find lamps: the table comes back in its place.

[#146]: https://github.com/daczarne/streamdeck-litra/issues/146
[#171]: https://github.com/daczarne/streamdeck-litra/issues/171
[lamp-picker]: lamp_picker.md
[lamp-screens]: lamp_screens.md
[lamps-apart]: lamps_apart.md
