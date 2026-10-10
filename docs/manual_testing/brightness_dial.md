# Testing the brightness dial

- [How the plugin learns caps](#how-the-plugin-learns-caps)
- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)
- [Known gap](#known-gap)

The unit tests check the dial's logic against fake lamps, which do what we measured a real lamp do with [the brightness probe][probe]: a lamp on a low-power supply stops at its cap, reports the brightness it was sent for up to about 100 ms, then the one it reached. They take that for granted, along with how the touch strip shows the result. The checks below cover both, on the Deck, with every connected lamp managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## How the plugin learns caps

The plugin never sends a lamp more than the cap it has learned for it, and it only learns a cap when it sees a lamp fall short of what it was sent: 250 ms after each turn of the dial, it reads the lamps back, and a lamp that reached less than it was sent has that brightness stored as its cap. Whether a lamp moved to another power supply gets its new cap depends on the direction:

- **Hub after Mac (the cap goes down):** the plugin still sends up to the old cap, or up to 100% if it had none. The lamp falls short, the read-back shows it, and the plugin stores the lower cap. Using the dial as usual is what teaches it.
- **Mac after hub (the cap goes up):** the plugin never sends more than the stored cap, so the lamp reaches exactly what it's sent. The read-back looks normal, and nothing tells the plugin the lamp could do more.

Finding a higher cap would take asking for more than the stored one. On a lamp still on the hub, that request lets the lamp undo the next second's writes (see [Known gap](#known-gap)), so it needs a protection the plugin doesn't have yet. Until then, a restart forgets every stored cap, and is the way to raise them.

## When to run these checks

- After a change to how the plugin reads or writes brightness, or to the dial's debouncing.
- After a Stream Deck or lamp firmware update.
- When a lamp moves to another power supply for good.

## Setup

Plug both Beams into the Stream Deck + XL's USB hub, as they're used every day, so each has its own cap below 100%. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

Restarting also clears the caps the plugin has learned, so the checks start from scratch.

## Checks

1. **The strip shows what the lamps reached.** Turn the dial up quickly, well past where the lamps stop. The strip stops at the brightest lamp's cap (about 79% on the first port), not at the % asked for, and the next turn doesn't make it jump.
2. **The lamps move together.** Turn the dial down step by step, waiting a couple of seconds after the first step. Both lamps dim at each step. While the target is above a lamp's cap, that lamp stays at its cap and the other one follows the dial. Below both caps, they're at the same brightness.
3. **A lamp at its cap isn't asked for more.** With both lamps at their caps, turn the dial up and then straight back down. The lamps dim on the way down and stay there.
4. **Without caps, nothing changes.** Plug both lamps into the Mac, restart the plugin, and repeat check 2. The dial goes up to 100%, and both lamps follow every step.
5. **A lower cap is learned without a restart.** Right after check 4, plug both lamps back into the hub, without restarting the plugin. Turn the dial up past where the lamps stop: the strip stops at the brightest lamp's cap again, and checks 2 and 3 pass as before.

## Known gap

Both are tracked in [#55]:

- **The first request above a cap.** The plugin learns a lamp's cap by asking for more than the lamp can do. For about a second after that request, the lamp can undo a lower brightness written in the meantime, so turning down right after the first turn past the caps can leave a lamp at its cap while the strip shows less. It can happen each time a cap is learned: after a restart, or after a lamp moves to a weaker supply.
- **A cap that goes up.** A lamp moved from the hub to the Mac keeps its old cap until the plugin restarts, as described in [How the plugin learns caps](#how-the-plugin-learns-caps).

[#55]: https://github.com/daczarne/streamdeck-litra/issues/55
[contributing]: ../contributing.md
[probe]: ../../scripts/probes/README.md
