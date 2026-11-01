# Testing the scene key

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

A Scene key sets its lamps to its scene in one press ([#86]). A scene is made of groups, each of which turns its lamps off, or on at its own brightness and temperature, and no two groups hold the same lamp ([#174]). The unit tests check against emulated lamps that each lamp is turned on, then set to the temperature, snapped to one it allows, then to the brightness, within its cap, and that a scene waits its turn behind a brightness change, and, for a scene of several groups, that each lamp takes its group's part, and that a group that's off turns its lamps off and leaves their brightness and temperature ([#174]). They check against a fake Stream Deck what the key sends for its settings, and the integration tests that the Power keys and the dials follow a press. The browser tests check the page in a headless Chrome: the presets hidden while a group is off, adding, saving and removing groups, and a lamp a group holds, the first group included, greyed out in the other groups, with the group that holds it. The checks below cover what they take for granted: that Stream Deck offers the action with its icon and image, shows its settings page legibly in its panel, and passes on its settings, and that the lamps and the touch strip show the result. The first group acts on every lamp the plugin knows: picking a key's lamps is checked in [`lamp_picker.md`][lamp-picker].

## When to run these checks

- After a change to how the plugin sets a scene, to the Scene key's settings page, or to its images.
- After a Stream Deck update.

## Setup

Plug two Beams into a Stream Deck + XL's USB hub, so each has its own cap below 100%, and call them lamp 1 and lamp 2, in the order the lamp picker lists them. Place a Power key, a Brightness dial, a Temperature dial and two Scene keys on the Deck, one set to 100% and 6500 K and the other to 0% and 2700 K, both with no group added. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both. After a change to `manifest.json`, such as the one that added the action, quit and reopen Stream Deck instead of restarting the plugin.

## Checks

1. **The action is offered.** Under Litra, the actions list offers "Scene" with its icon, a thermometer and half a sun. A Scene key shows the thermometer and the half sun, without a title.
2. **The settings page.** Selecting a Scene key shows a Power list set to On, a Brightness field from 0% to 100% and a Temperature field from 2700 K to 6500 K, each with − and + on either side, then the Lamps item (see [`lamp_picker.md`][lamp-picker]), and an "Add a group" button. No group heading shows.
3. **A press sets the scene.** Turn the lamps off, then press the 100% and 6500 K key. Both lamps turn on, go to their caps and turn cool. The Power key shows on, the Brightness dial shows the brighter lamp's cap, and the Temperature dial shows 6500.
4. **Another scene brings them back.** Press the 0% and 2700 K key: about a second later, since the caps were just learned, both lamps dim to their lowest and turn warm. The dials show 0% and 2700.
5. **The log tells the press and each lamp.** `logs/litra.log` has a `Scene: Key pressed: scene 100% at 6500 K on every lamp` line, then, for each lamp, the lines of `set scene`: turned on, set to 6500 K, the lumens sent and reached, and the cap the first time it's learned.
6. **A scene can turn its lamps off.** On the 0% and 2700 K key's page, set Power to Off: Brightness and Temperature hide. Press the key: both lamps turn off, and the Power key shows off. Set Power back to On: Brightness and Temperature show again, at 0% and 2700 K.
7. **A group is added.** On the 100% and 6500 K key's page, press "Add a group". A "Group 1" heading shows above the first Power list, and a "Group 2" heading under the first group's Lamps, followed by a Power list set to On, Brightness at 0%, Temperature at 2700 K, a checkbox for each lamp, and a "Remove group 2" button. Both lamps are greyed out, with "in group 1" next to them, since the first group has every lamp. "Add a group" moves under it.
8. **A lamp moves from one group to another.** Uncheck lamp 1 in the first group's Lamps: in Group 2, lamp 1 is no longer greyed out. Check it there: in the first group's Lamps, lamp 1 shows unchecked and greyed out, with "in group 2" next to it. Press "Add a group": in Group 3, lamp 1 is greyed out with "in group 2", and lamp 2 with "in group 1". Press "Remove group 3".
9. **A press sets each group.** Set Group 2 to 30% and 3000 K, turn the lamps off, and press the key. Lamp 2 turns on, goes to its cap and turns cool, and lamp 1 turns on at 30% and turns warm. The Power key shows on. Tap the Brightness dial's strip through its lamp screens: each lamp shows its own brightness and temperature.
10. **A group can turn its lamps off.** Set Group 2's Power to Off: its Brightness and Temperature hide. Press the key: lamp 1 turns off, lamp 2 stays at its cap and 6500 K, and the Power key shows off, since not every lamp is on. `logs/litra.log` has a `Scene: Key pressed: scene 100% at 6500 K on every lamp but 1 lamp; off on 1 lamp` line, then a `set scene` line for lamp 1 turning off, and lamp 2's lines.
11. **The groups are kept.** Select another key, then the Scene key again: Group 2 shows as it was left, and so does the first group's Lamps. Restart the plugin, and check again.
12. **A group is removed.** Press "Remove group 2": its heading and controls go, and so does the "Group 1" heading. In the first group's Lamps, lamp 1 is no longer greyed out, and shows unchecked, as it was left before Group 2 took it. Check it, and press the key: both lamps go to their caps at 6500 K.
13. **A lamp no group holds is left as it is.** Uncheck lamp 1 in the first group's Lamps, with no group added, so no group holds it. Tap the Brightness dial's strip to lamp 1's screen, turn the dial to 20%, and tap back to the main screen. Press the key: lamp 2 goes to its cap at 6500 K, and lamp 1 stays on at 20% and its temperature. `logs/litra.log` has a `Scene: Key pressed: scene 100% at 6500 K on every lamp but 1 lamp` line, and `set scene` lines for lamp 2 alone.

[#86]: https://github.com/daczarne/streamdeck-litra/issues/86
[#174]: https://github.com/daczarne/streamdeck-litra/issues/174
[lamp-picker]: lamp_picker.md
