# Testing the brightness dial

- [How the plugin learns caps](#how-the-plugin-learns-caps)
- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check the logic of the dial and the Brightness keys, and the integration tests check it from a key press or a turn to what every dial is told to show. Wherever they reach a lamp, it's an emulated one, which does what [the brightness probe][probe] measured a real lamp do: a lamp on a low-power supply stops at its cap, reports the brightness it was sent for about 100 ms, then the one it reached, and goes back to its cap a second after being asked for more, undoing a lower brightness written in between. The tests take that for granted, along with how the touch strip shows the result. The checks below cover both, on the Deck, with every connected lamp managed as one group from the dial's main screen (see "By default, lamps are managed together" in [the contributing guide][contributing]).

## How the plugin learns caps

The plugin never sends a lamp more than the cap it has learned for it, and it only learns a cap when it sees a lamp fall short of what it was sent: 250 ms after each turn of the dial or press of a Brightness key, it reads the lamps back, and a lamp that reached less than it was sent has that brightness stored as its cap.

A lamp only moves to another power supply by being plugged in again, and macOS then gives it a new path, even when it goes back into the same port (checked on two Beams on 2026-10-16). The plugin keeps each cap with the path its lamp had when it learned it, and forgets the cap once the lamp shows up under another path. Whichever way the cap moved, the next press or turn finds it afresh: plugged into the computer, the lamp reaches 100%, and on a hub, it falls short and its cap is stored again.

Asking a lamp for more than its cap is how the plugin learns it, and for about a second after that request, the lamp can go back to its cap, undoing a lower brightness written in the meantime ([the brightness probe][probe]). So once a read-back finds a cap, the next brightness change waits until 1.5 s after the write that went above it, when a write stays. The dial lags only then: after a restart, or after a lamp is plugged into a supply that caps it.

## When to run these checks

- After a change to how the plugin reads or writes brightness, to how the dial steps or debounces, to what the dials show, or to the action's images.
- After a Stream Deck or lamp firmware update.
- When a lamp moves to another power supply for good.

## Setup

Plug two Beams into a Stream Deck + XL's USB hub, so each has its own cap below 100%. Place two Brightness dials and two Brightness keys on the Deck, one key set to 100% and the other to 30%. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

Restarting also clears the caps the plugin has learned, so the checks start from scratch.

## Checks

1. **A key moves the dials to what the lamps reached.** Press the 100% key. Both lamps go to their caps, and both strips show the brightest lamp's cap, not 100%. Then, right away, press the 30% key: about a second later, both lamps dim to 30%, and both strips show 30%.
2. **The strip shows what the lamps reached.** Turn a dial up quickly, well past where the lamps stop. Both strips stop at the brightest lamp's cap, not at the % asked for, and the next turn doesn't make them jump.
3. **Every dial shows the same.** Turn one dial a few steps either way. After each step, the other dial shows the same value as the one turned.
4. **The lamps move together.** Turn a dial down step by step. Both lamps dim at each step. While the target is above a lamp's cap, that lamp stays at its cap and the other one follows the dial. Below both caps, they're at the same brightness.
5. **A lamp at its cap isn't asked for more.** With both lamps at their caps, turn a dial up and then straight back down. The lamps dim on the way down and stay there. Then press the 100% key, and right after it the 30% key: both lamps end at 30%. Press the 100% key again: both lamps go back to their caps, not to 30%.
6. **A turn back down isn't undone.** Restart the plugin, then turn a dial up quickly past the caps and straight back down. Both lamps go to their caps, dim about a second later, and stay there, and both strips show where they ended.
7. **Without caps, nothing changes, and no restart is needed.** Plug both lamps into the computer, without restarting the plugin, and repeat checks 1 and 4. The 100% key and the dial both go up to 100%, the 30% key dims the lamps right away, and both lamps follow every step. The log says each lamp was plugged in again and its cap is forgotten.
8. **A lower cap is learned without a restart.** Right after check 7, plug both lamps back into the Deck's hub, without restarting the plugin. Press the 100% key: the strips show the brightest lamp's cap again, and checks 4 and 5 pass as before.
9. **Going down retraces going up.** Set one dial's step to 25 in its settings. Press the 30% key, then turn that dial up one step at a time: the strips show each multiple of 25 from 50% up to the brightest lamp's cap, then the cap. Turn it down one step at a time: the same multiples of 25 as on the way up, down to 0% ([#14]). Set the step back to 5.
10. **The dial says what it does.** Both strips show "Brightness" at the top, above the icon and the value. If a strip shows none, check **Show Title** under the **T** menu of the dial's settings, which Stream Deck keeps for each dial. A title typed in the title field replaces it.
11. **The bar shows where each lamp stops.** Press the 100% key: each strip's bar is white up to the dimmer lamp's cap, and light grey from there to the brightest lamp's cap, with a sharp edge between them ([#59]). Turn a dial down below the dimmer lamp's cap: the bar turns plain white.
12. **The keys and the app's dial pictures show the strip's icon.** In the Stream Deck app, the round picture of each Brightness dial shows the white line sun from its touch strip ([#51]). So does a Brightness key or dial newly dragged onto the Deck. A key or dial given a custom image keeps it.

[#14]: https://github.com/daczarne/streamdeck-litra/issues/14
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#59]: https://github.com/daczarne/streamdeck-litra/issues/59
[contributing]: ../contributing.md
[probe]: ../../scripts/probes/README.md
