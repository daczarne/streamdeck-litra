# Testing the plugin settings

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Every settings page, on a key or a dial, has a Plugin settings button at its top, which shows the plugin's own settings in place of the action's ([#146]), in sections by what they reach. "Lamps" has a Find lamps button and a table of the lamps the plugin knows ([#194]), each by the end of its id and its model, with a field for its name, an Identify button that blinks it, and a trash can that forgets it, then how each lamp steps (see [`lamps_apart.md`][lamps-apart]) and how long a blink lasts ([#171]). "Keys" has whether every key takes in lamps added later (see [`lamp_picker.md`][lamp-picker]). "Dials" has the lamp screens' settings. The plugin alone saves the lamps, their names included, to its global settings: the page asks it to find them, and to rename or forget one, and the keys' lamp pickers show the names (see [`lamp_picker.md`][lamp-picker]). The unit tests check against emulated lamps that the plugin lists each lamp with its model and the end of its id, and blinks the one asked for, for as long as the global settings say, and that it adds, renames and forgets the lamps it knows, keeping the other global settings. The browser tests check every page in a headless Chrome, with a fake standing in for Stream Deck and the plugin: the button, that the plugin settings take the action's place and give it back, the table, the messages a name, Find lamps, Identify and the trash can send, that a name being typed stays as typed, with its field focused, as the plugin's saves of it arrive, the lamps the table lists once the plugin saves them, and the blink's number field: its default, its ends, the value it shows, with its unit beside it and the two centered, and what it saves. The checks below cover what they take for granted: that Stream Deck draws the button, the sections and their headings, the table, or the message that stands in for it when no lamp is found, and the number field legibly in its panel, carries the page's messages to the plugin and back, passes the plugin's save on to the page, and keeps the names and the blink's length, and that the lamps follow.

## When to run these checks

- After a change to the plugin settings (`ui/plugin-settings.js`), to the lamp picker's names (`ui/lamp-picker.js`), to how the plugin finds or blinks the lamps, or to the lamps it knows ([#194]).
- After a Stream Deck update, or an update of the vendored sdpi-components.

## Setup

Plug in two Beams, turned on, and keep a third lamp unplugged for checks 15 and 16, a Beam LX for check 17. Place a Power key and a Brightness dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **Every page has the button.** Select the Power key, then the Brightness dial: each page shows a Plugin settings button first, under the title, as wide as the controls below it. Share a screenshot of each panel.
2. **The plugin settings take the page.** Press Plugin settings on the Power key: the button reads Back, and under it comes the "Lamps" heading, with a line under it. Then come Find lamps and a table with ID, Model and Name, and a row for each lamp, such as "c870", "Beam", an empty name field with "Beam - c870" in grey, Identify, and a button with a trash can, as tall as Identify and with the same border and background, the can centered in it and drawn in the button's text color. Hovering the trash can turns its button a dark red, with a lighter red border and a white can, and pressing it greys it again, with the can in red. Under the table, "Brightness" and "Temperature" each show a checkbox, and "Blink length" a number field at "400 ms", on one line and centered in the field, with − and + on either side. Then comes the "Keys" heading, with "New lamps" and its checkbox, "Add new lamps automatically, on every key", checked. Then comes the "Dials" heading, and under it "Lamp screens", centered, with "Blink" and its checkbox, "Layout" with six lists in three rows of two, each with a Configure button under it (see [`lamp_screens.md`][lamp-screens]), and "Text styles", a color, a weight and a size for each of "Primary", "Secondary", "Accent" and "Alert", each with a Reset button under them. None of the key's own settings show. The rows come in the order of the lamps' ids. Press Identify on each row: the lamp that blinks is the row's, which tells the lamps apart, since the 4 characters under ID match nothing printed on them. `logs/litra.log` has no `Lamp picker` line for the plugin settings opening, which look for no lamps. Share a screenshot of the panel.
3. **Identify blinks the lamp.** With both lamps at 0%, press Identify on the first row: that lamp fades to dark, clearly enough to tell even with the other one on, and comes back at the same brightness. The other one doesn't change.
4. **A name is saved, and the picker shows it.** Type "Left" in the first lamp's name: the field keeps every letter as it's typed, and its cursor stays at the end. Press Back: the key's settings show again, and its Lamps item lists "Left" in place of the first lamp's label. Select the dial, then the key again: the name is still there.
5. **A name is at most 24 characters.** Type a long name: the field takes 24 characters and no more.
6. **The names are the plugin's.** Open the plugin settings on the dial: they show the same names. Rename the second lamp there, then select the key: its Lamps item shows the new name.
7. **An emptied name gives the label back.** Empty the first lamp's name: the key's Lamps item lists it as "Beam - " and the end of its id again.
8. **Find lamps marks a lamp unplugged.** Unplug the second lamp, open the plugin settings, and press Find lamps: the second lamp's row is greyed out but for its name, with "Not found" in red in place of Identify, every column as wide as before, and its trash can still there. Plug it back in and press Find lamps again: its row is as before, with its name and Identify. Press Back: the key's Lamps item lists it too.
9. **The names survive a restart.** Name both lamps, restart the plugin, then quit and reopen Stream Deck: the plugin settings and the keys' Lamps items still show the names.
10. **The log tells each request.** `logs/litra.log` has a `Lamp picker` line each time Find lamps is pressed, one for each Identify, and one for each trash can pressed, followed by a `Lamp forgotten:` line.
11. **The blink's length is the plugin's.** With both lamps at 100%, press Identify: at 400 ms, the lamp only dims part of the way. Set Blink length to 600 ms, and press Identify: the lamp fades almost to dark, clearly enough to tell even with the other one on. Set it to 1500 ms. Press Identify: the lamp stays dark for a moment before it comes back. Select the Brightness dial, tap its strip to the first lamp's screen, and hold the strip: the lamp blinks just as long. Restart the plugin and press Identify again: still as long, and the field still shows "1500 ms". Set it back to 400 ms, to leave the default.
12. **A lamp is forgotten.** Turn both lamps on. Press the second lamp's trash can: its row goes, and the first lamp's stays. Press the Power key in its toggle mode: the first lamp turns off, and the second stays on. Tap the Brightness dial's strip: its lamp screens show the first lamp alone. Press Find lamps: the second lamp is listed again, with no name. Press the key: the first lamp turns on, and the second one stays on. Press it again: both turn off.
13. **No lamps stands out.** Press both lamps' trash cans: "No lamps found" shows centered under Find lamps, in red and in bold, larger than the labels around it, and in the panel's font.
14. **The plugin finds the lamps when it knows none.** With the plugin knowing no lamps, as check 13 leaves it, restart the plugin. `logs/litra.log` has a `No lamps known: finding the lamps connected` line, then `Lamps added:` with both Beams, and the plugin settings list both, with no names. Restart the plugin again: neither line comes again.
15. **A lamp plugged in is left alone until it's found.** Plug in the third lamp, and turn every lamp on. Press the Power key in its toggle mode: the Beams turn off, and the third lamp stays on. Open the plugin settings: the third lamp isn't listed. Press Find lamps: it's listed, and `logs/litra.log` has a `Lamps added:` line with it. Press the key: the Beams turn on. Press it again: every lamp turns off, the third one included.
16. **A page's save keeps the lamps the plugin knows.** In the plugin settings, set Blink length to 600 ms and back to 400 ms, which saves the global settings from the page. Restart the plugin, and press the Power key: every lamp turns on, the third one included, and `logs/litra.log` has no `No lamps known` line.
17. **A Beam LX has a serial number of its own.** Its USB descriptor gives none, so the plugin asks the lamp for it ([#170]). With the Beam LX found, as the third lamp of check 15: its row shows the last 4 characters of its id under ID, as any lamp does, and its name field shows "Beam LX - " followed by them in grey. Identify blinks it, and the Brightness dial's lamp screens show it with the same label. `logs/litra.log` names it as "Beam LX - " followed by the same 4 characters, and has no `failed` line for it. A Beam LX the plugin knew before this check, with an empty ID, shows as a row with "Not found": forget it with its trash can.
18. **"Not found" follows every press.** With the plugin settings open on the Power key, unplug the second lamp, and press the key: the second lamp's row is greyed out, with "Not found", without pressing Find lamps. Plug it back in and press the key again: its row is as before, with Identify ([#198]).

[#146]: https://github.com/daczarne/streamdeck-litra/issues/146
[#170]: https://github.com/daczarne/streamdeck-litra/issues/170
[#171]: https://github.com/daczarne/streamdeck-litra/issues/171
[#194]: https://github.com/daczarne/streamdeck-litra/issues/194
[#198]: https://github.com/daczarne/streamdeck-litra/issues/198
[lamp-picker]: lamp_picker.md
[lamp-screens]: lamp_screens.md
[lamps-apart]: lamps_apart.md
