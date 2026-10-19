# Testing the scene key

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

A Scene key turns every lamp on at its brightness and temperature in one press ([#86]). The unit tests check against emulated lamps that each lamp is turned on, then set to the temperature, snapped to one it allows, then to the brightness, within its cap, and that a scene waits its turn behind a brightness change. They check against a fake Stream Deck what the key sends for its settings, and the integration tests that the Power keys and the dials follow a press. The checks below cover what they take for granted: that Stream Deck offers the action with its icon and image, shows its settings page, and passes on its settings, and that the lamps and the touch strip show the result. Every connected lamp is managed as one group (see "By default, lamps are managed together" in [the contributing guide][contributing]).

## When to run these checks

- After a change to how the plugin sets a scene, to the Scene key's settings page, or to its images.
- After a Stream Deck update.

## Setup

Plug two Beams into a Stream Deck + XL's USB hub, so each has its own cap below 100%. Place a Power key, a Brightness dial, a Temperature dial and two Scene keys on the Deck, one set to 100% and 6500 K and the other to 0% and 2700 K. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both. After a change to `manifest.json`, such as the one that added the action, quit and reopen Stream Deck instead of restarting the plugin.

## Checks

1. **The action is offered.** Under Litra, the actions list offers "Scene" with its icon, a thermometer and half a sun. A Scene key shows the thermometer and the half sun, without a title.
2. **The settings page.** Selecting a Scene key shows a Brightness slider from 0% to 100% and a Temperature slider from 2700 K to 6500 K, each with its value next to it.
3. **A press sets the scene.** Turn the lamps off, then press the 100% and 6500 K key. Both lamps turn on, go to their caps and turn cool. The Power key shows on, the Brightness dial shows the brighter lamp's cap, and the Temperature dial shows 6500.
4. **Another scene brings them back.** Press the 0% and 2700 K key: about a second later, since the caps were just learned, both lamps dim to their lowest and turn warm. The dials show 0% and 2700.
5. **The log tells the press and each lamp.** `logs/litra.log` has a `Scene: Key pressed: scene 100% at 6500 K` line, then, for each lamp, the lines of `set scene`: turned on, set to 6500 K, the lumens sent and reached, and the cap the first time it's learned.

[#86]: https://github.com/daczarne/streamdeck-litra/issues/86
[contributing]: ../contributing.md
