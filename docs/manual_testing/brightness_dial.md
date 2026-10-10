# Testing the brightness dial

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)
- [Known gap](#known-gap)

The unit tests check the dial's logic against fake lamps, which do what we measured a real lamp do with [the brightness probe][probe]: a lamp on a low-power supply stops at its cap, reports the brightness it was sent for up to about 100 ms, then the one it reached. They take that for granted, along with how the touch strip shows the result. The checks below cover both, on the Deck, with every connected lamp managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

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

## Known gap

The plugin learns a lamp's cap the first time the lamp stops below what it was sent. For about a second after that first request above the cap, the lamp can undo a lower brightness written in the meantime, so turning down right after the first turn past the caps can leave a lamp at its cap while the strip shows less. The same happens after a restart. A lamp moved from the hub to the Mac also keeps its old cap until the plugin restarts. Both are tracked in [#55].

[#55]: https://github.com/daczarne/streamdeck-litra/issues/55
[contributing]: ../contributing.md
[probe]: ../../scripts/probes/README.md
