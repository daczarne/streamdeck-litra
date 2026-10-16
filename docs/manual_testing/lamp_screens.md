# Testing the lamp screens

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Tapping a Brightness or Temperature dial's part of the touch strip shows one screen per lamp ([#48]). The unit tests check against a fake Stream Deck which lamp comes next, when a dial goes back to its main screen, and which changes redraw a lamp screen, and against emulated lamps that a push blinks that lamp alone. The integration tests check against emulated lamps that a lamp screen shows what its lamp reports and follows what other actions change, that what it sends fits `layouts/lamp.json`, and that a dial taken off the Deck is forgotten, so the lamps changing no longer redraw it. The checks below cover what they take for granted: that Stream Deck delivers the taps and holds, switches to the lamp layout and back, and draws it legibly, and that the lamps report what they show.

## When to run these checks

- After a change to the lamp screens, to their layout in `layouts/lamp.json`, or to how the plugin reads the lamps.
- After a Stream Deck update.

## Setup

Plug in two Beams, turned on at different brightness and temperature, using their own buttons if needed. Place a Brightness dial and a Temperature dial on the Deck, and a Power key. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

## Checks

1. **The screen is readable.** Tap the Brightness dial's strip. It shows the first lamp: "Beam · 1 of 2" and "On" on the first row, the sun icon with the % and the lumens on the second, and the thermometer icon with the kelvin on the third. Every value reads clearly from where you sit. Share a photo of the strip.
2. **Each lamp in turn.** Tap again: the strip shows "Beam · 2 of 2" with the other lamp's values. Tap again: the strip goes back to the brightness with its bar.
3. **The two lamps tell apart.** Dim one lamp with its own button, then tap through both screens: only one shows the lower brightness, and it stays the same lamp ("1 of 2" or "2 of 2") on every cycle.
4. **Holding goes back.** Tap to a lamp screen, then hold the strip: the strip goes back to the brightness right away.
5. **A lamp screen stays.** Tap to a lamp screen and leave the dial alone for a minute: the strip still shows the lamp screen.
6. **Turning does nothing.** On a lamp screen, turn the dial: the lamps don't change, and neither does the screen.
7. **Pushing blinks the lamp on screen.** On a lamp screen, push the dial: only that lamp goes off for a moment and comes back at the same brightness and temperature. Turn that lamp off with its own button, tap through to its screen again, and push: it lights up for a moment and goes off again. On the main screen, a push still toggles every lamp.
8. **Other changes show.** Put the Temperature dial on a lamp screen, then turn the Brightness dial and press the Power key: the Temperature dial's lamp screen shows the new brightness, then the new power state.
9. **The app describes the gestures.** Select the dial in Stream Deck: it lists "Lamps" for touching the strip. On a lamp screen, it lists "Identify" for a push, "Next lamp" for a touch, "Back" for a long touch, and nothing for rotating.
10. **Unplugging mid-cycle.** Tap to "1 of 2", unplug the other lamp, and tap: the strip goes back to the main screen. Plug it back in, tap to "1 of 2", unplug the lamp on screen, and tap: the strip shows the remaining lamp as "1 of 1".
11. **Switching pages.** Tap to a lamp screen, switch to another page of the Deck and back: the dial shows its main screen.

[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
