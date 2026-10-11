# Testing the brightness dial

- [How the plugin learns caps](#how-the-plugin-learns-caps)
- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)
- [Known gap](#known-gap)

The unit tests check the logic of the dial and the Brightness keys against fake lamps, which do what we measured a real lamp do with [the brightness probe][probe]: a lamp on a low-power supply stops at its cap, reports the brightness it was sent for up to about 100 ms, then the one it reached. They take that for granted, along with how the touch strip shows the result. The checks below cover both, on the Deck, with every connected lamp managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## How the plugin learns caps

The plugin never sends a lamp more than the cap it has learned for it, and it only learns a cap when it sees a lamp fall short of what it was sent: 250 ms after each turn of the dial or press of a Brightness key, it reads the lamps back, and a lamp that reached less than it was sent has that brightness stored as its cap. Whether a lamp moved to another power supply gets its new cap depends on the direction:

- **Hub after Mac (the cap goes down):** the plugin still sends up to the old cap, or up to 100% if it had none. The lamp falls short, the read-back shows it, and the plugin stores the lower cap. Using the dial or the keys as usual is what teaches it.
- **Mac after hub (the cap goes up):** the plugin never sends more than the stored cap, so the lamp reaches exactly what it's sent. The read-back looks normal, and nothing tells the plugin the lamp could do more.

Finding a higher cap would take asking for more than the stored one. On a lamp still on the hub, that request lets the lamp undo the next second's writes (see [Known gap](#known-gap)), so it needs a protection the plugin doesn't have yet. Until then, a restart forgets every stored cap, and is the way to raise them.

## When to run these checks

- After a change to how the plugin reads or writes brightness, to how the dial steps or debounces, to what the dials show, or to the action's images.
- After a Stream Deck or lamp firmware update.
- When a lamp moves to another power supply for good.

## Setup

Plug both Beams into the Stream Deck + XL's USB hub, as they're used every day, so each has its own cap below 100%. Place two Brightness dials and two Brightness keys on the Deck, one key set to 100% and the other to 30%. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

Restarting also clears the caps the plugin has learned, so the checks start from scratch.

## Checks

1. **A key moves the dials to what the lamps reached.** Press the 100% key. Both lamps go to their caps, and both strips show the brightest lamp's cap (about 79% on the first port), not 100%. Wait a couple of seconds (see [Known gap](#known-gap)), then press the 30% key: both lamps dim to 30%, and both strips show 30%.
2. **The strip shows what the lamps reached.** Turn a dial up quickly, well past where the lamps stop. Both strips stop at the brightest lamp's cap, not at the % asked for, and the next turn doesn't make them jump.
3. **Every dial shows the same.** Turn one dial a few steps either way. After each step, the other dial shows the same value as the one turned.
4. **The lamps move together.** Turn a dial down step by step, waiting a couple of seconds after the first step. Both lamps dim at each step. While the target is above a lamp's cap, that lamp stays at its cap and the other one follows the dial. Below both caps, they're at the same brightness.
5. **A lamp at its cap isn't asked for more.** With both lamps at their caps, turn a dial up and then straight back down. The lamps dim on the way down and stay there. Then press the 100% key, and right after it the 30% key: both lamps end at 30%. Press the 100% key again: both lamps go back to their caps, not to 30%.
6. **Without caps, nothing changes.** Plug both lamps into the Mac, restart the plugin, and repeat checks 1 and 4. The 100% key and the dial both go up to 100%, and both lamps follow every step.
7. **A lower cap is learned without a restart.** Right after check 6, plug both lamps back into the hub, without restarting the plugin. Press the 100% key: the strips show the brightest lamp's cap again, and checks 4 and 5 pass as before.
8. **Going down retraces going up.** Set one dial's step to 25 in its settings. Press the 30% key, then turn that dial up one step at a time: the strips show 50%, 75%, then the brightest lamp's cap (about 79%). Turn it down one step at a time: 75%, 50%, 25%, 0%, the same multiples of 25 as on the way up ([#14]). Set the step back to 5.
9. **The dial says what it does.** Both strips show "Brightness" at the top, above the icon and the value. If a strip shows none, check **Show Title** under the **T** menu of the dial's settings, which Stream Deck keeps for each dial. A title typed in the title field replaces it.
10. **The bar shows where each lamp stops.** Press the 100% key: each strip's bar is white up to the dimmer lamp's cap (about 63% on the second port), and light grey from there to the brightest lamp's cap, with a sharp edge between them ([#59]). Turn a dial down below the dimmer lamp's cap: the bar turns plain white.
11. **The keys and the app's dial pictures show the strip's icon.** In the Stream Deck app, the round picture of each Brightness dial shows the white line sun from its touch strip ([#51]). So does a Brightness key or dial newly dragged onto the Deck. A key or dial given a custom image keeps it.

## Known gap

Both are tracked in [#55]:

- **The first request above a cap.** The plugin learns a lamp's cap by asking for more than the lamp can do, from a dial or a key. For about a second after that request, the lamp can undo a lower brightness written in the meantime, so turning down right after the first turn or key press past the caps can leave a lamp at its cap while the strip shows less. It can happen each time a cap is learned: after a restart, or after a lamp moves to a weaker supply.
- **A cap that goes up.** A lamp moved from the hub to the Mac keeps its old cap until the plugin restarts, as described in [How the plugin learns caps](#how-the-plugin-learns-caps).

[#14]: https://github.com/daczarne/streamdeck-litra/issues/14
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#55]: https://github.com/daczarne/streamdeck-litra/issues/55
[#59]: https://github.com/daczarne/streamdeck-litra/issues/59
[contributing]: ../contributing.md
[probe]: ../../scripts/probes/README.md
