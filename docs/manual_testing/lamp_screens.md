# Testing the lamp screens

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Tapping a Brightness or Temperature dial's part of the touch strip shows one screen per lamp ([#48]), where the dial controls that lamp alone ([#20]). The unit tests check against a fake Stream Deck which lamp comes next, when a dial goes back to its main screen, which changes redraw a lamp screen, that a turn, a push and a hold ask for the lamp on screen, a turn's ticks for the lamp they were turned on, and that the power of a lamp that's off is drawn in bold dark grey, and in white again once it's on. They check that, with the blink of the dials' global setting on ([#144]), a tap blinks the lamp it shows once its screen is drawn, the way back to the main screen blinks nothing, and a tap during a blink waits for it to end. They check against emulated lamps that a blink, a toggle and a step reach that lamp alone. The integration tests check against emulated lamps that a lamp screen shows what its lamp reports and follows what other actions change, that what it sends fits `layouts/lamp.json`, that each dial turns and toggles its lamp alone until a turn on a main screen brings the lamps back in sync, that a dial taken off the Deck is forgotten, so the lamps changing no longer redraw it, and that once a settings page turns the blink on, a tap on any dial blinks the lamp it shows. The browser tests check that both dials' settings pages show the blink's checkbox, unchecked by default, and save it to the plugin's global settings rather than the dial's. The checks below cover what they take for granted: that Stream Deck delivers the taps and holds, switches to the lamp layout and back, and draws it legibly, that it keeps the global settings and passes them on to the plugin, and that the lamps report what they show.

## When to run these checks

- After a change to the lamp screens, to their layout in `layouts/lamp.json`, to how the plugin reads the lamps or picks the ones an operation acts on, or to the plugin's global settings.
- After a Stream Deck update.

## Setup

Plug in two Beams, turned on at different brightness and temperature, using their own buttons if needed. Place a Brightness dial and a Temperature dial on the Deck, and a Power key. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **The screen is readable.** Tap the Brightness dial's strip. It shows the first lamp: "Beam - " followed by the last 4 characters of its serial number, with "1 of 2" at the right, on the first row, the thermometer icon with the kelvin and "On" at the right on the second, and the sun icon with the % and the lumens on the third. Every value reads clearly from where you sit. Share a photo of the strip.
2. **Each lamp in turn.** Tap again: the strip shows the other lamp's label, "2 of 2" and its values. Each label is the one a key's settings page lists for that lamp ([`lamp_picker.md`][lamp-picker]). Tap again: the strip goes back to the brightness with its bar.
3. **Holding blinks the lamp on screen.** On a lamp screen, hold the strip: only that lamp goes off for a moment and comes back at the same brightness and temperature, and the strip stays on its screen. Turn that lamp off with its own button, tap through to its screen again, and hold: it lights up for a moment and goes off again. On the main screen, holding the strip does nothing.
4. **A lamp screen stays.** Tap to a lamp screen and leave the dial alone for a minute: the strip still shows the lamp screen. Only tapping past the last lamp goes back to the main screen.
5. **Turning moves the lamp on screen.** On the Brightness dial, tap to "1 of 2" and turn the dial: only lamp 1's brightness changes, and its screen shows the new %. Tap through both screens and back: the new % is still on "1 of 2". On the Temperature dial, tap to "2 of 2" and turn: only lamp 2's temperature changes. If lamp 1 was off, the brightness turn lights it, as a turn on the main screen does.
6. **Pushing toggles the lamp on screen.** On a lamp screen, push the dial: only that lamp turns off, and the screen shows "Off" in bold dark grey, while its other text stays white. Push again: it comes back on at the same brightness and temperature, and the screen shows "On" in white, like its other text. On the main screen, a push still toggles every lamp.
7. **A quick turn stays with its lamp.** On "1 of 2", turn the dial quickly by a few ticks and tap the strip straight away: only lamp 1 moves, and lamp 2, now on screen, keeps its values.
8. **The main screen brings the lamps back in sync.** With the lamps set apart, tap past the last lamp and turn the Brightness dial one tick: both lamps go to the same brightness. Do the same with the Temperature dial: both go to the same temperature.
9. **Other changes show.** Put the Temperature dial on a lamp screen, then turn the Brightness dial and press the Power key: the Temperature dial's lamp screen shows the new brightness, then the new power state.
10. **The app describes the gestures.** Select the dial in Stream Deck: it lists "Brightness" or "Temperature" for rotating, "Power" for a push and "Lamps" for touching the strip. On a lamp screen, it lists "Brightness" or "Temperature" for rotating, "Power" for a push, "Next lamp" for a touch and "Identify" for a long touch.
11. **Unplugging the other lamp mid-cycle.** Tap to "1 of 2", unplug the other lamp, and tap: the strip goes back to the main screen. Plug it back in.
12. **Unplugging the lamp on screen, then tapping.** Tap to "1 of 2", unplug the lamp on screen, and tap: the strip shows the remaining lamp as "1 of 1". Plug it back in.
13. **Unplugging the lamp on screen, then turning.** Tap to a lamp's screen, unplug that lamp, and turn the dial: the dial's part of the strip flashes red, Stream Deck's alert on a dial, and goes back to the main screen. Plug it back in.
14. **Switching pages.** Tap to a lamp screen, switch to another page of the Deck and back: the dial shows its main screen.
15. **Blinking each lamp as it's shown is off by default.** Select the Brightness dial in Stream Deck: under "Lamp screens", "Blink each lamp as it's shown, on every dial" is unchecked. Tap through the lamp screens: no lamp blinks.
16. **Blinking each lamp as it's shown.** Check it, and tap the Brightness dial's strip: the first lamp's screen shows, then that lamp alone goes off for a moment and comes back as it was. Tap again: the second lamp's screen shows, and it blinks. Tap again: the strip goes back to the main screen, and no lamp blinks.
17. **The blink is the same on every dial.** Select the Temperature dial: the checkbox is checked there too. Tap through its lamp screens: each lamp blinks as it's shown. Uncheck it there, and tap through the Brightness dial's lamp screens: no lamp blinks.
18. **A quick tap waits for the blink.** With the blink checked, tap the strip twice quickly: the first lamp blinks to the end, before the second lamp's screen shows and it blinks in turn.
19. **The blink outlasts a restart.** Check the blink, then restart the plugin with `npx streamdeck restart com.daczarne.litra`, and tap through the lamp screens: each lamp still blinks as it's shown. Quit Stream Deck and open it again: it still does. Uncheck it to leave the default.

[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[lamp-picker]: lamp_picker.md
