# Testing the temperature dial

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check that the Temperature keys and dials update every temperature dial, against a fake Stream Deck. The checks below cover what they take for granted: that Stream Deck lists every dial of the action, and that the touch strip shows what the plugin sends it. Every connected lamp is managed as one group (see "Lamps are managed together" in [the contributing guide][contributing]).

## When to run these checks

- After a change to how the plugin sets temperature, to how the dial steps, or to what the dials show.
- After a Stream Deck update.

## Setup

Plug in both Beams. Place two Temperature dials and two Temperature keys on the Deck, one key set to 3000 K and the other to 6000 K. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

## Checks

1. **A key moves the dials to its temperature.** Press the 3000 K key. Both lamps turn warm, and both strips show 3000. Press the 6000 K key: both lamps turn cool, and both strips show 6000.
2. **Every dial shows the same.** Turn one dial a few steps either way. After each step, the other dial shows the same value as the one turned.
3. **The keys keep their presets.** After checks 1 and 2, each key still shows its own preset, not the dials' value.
4. **Going down retraces going up.** Set one dial's step to 500 in its settings. Press the 3000 K key, then turn that dial up one step at a time: the strips show 3200, 3700, and so on up to 6200, then 6500. Turn it down one step at a time: 6200, 5700, and so on down to 3200, then 2700, the same temperatures as on the way up ([#16]). Set the step back to 100.

[#16]: https://github.com/daczarne/streamdeck-litra/issues/16
[contributing]: ../contributing.md
