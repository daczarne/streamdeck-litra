# Testing the actions list

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

Stream Deck's actions list offers the plugin's actions under Litra, with the names and in the order `manifest.json` gives them: Power, Scene, the brightness actions, then the temperature ones ([#236]). The unit tests check that the plugin registers every action the manifest lists, but not what Stream Deck shows of them. The checks below cover that, that every key and dial shows its value with its unit, and that keys and dials placed before a rename keep working under the new name, since Stream Deck finds an action by its UUID, which a rename leaves as it is. The icons each action shows in the list are checked with the action, in the document of its area.

## When to run these checks

- After a change to the actions in `manifest.json`: their names, their order, or a new action.
- After a change to what the keys or the dials show as their value.
- After a Stream Deck update.

## Setup

Plug in a Beam. Place a Brightness key and a Brightness dial on the Deck from `main`, before building the branch, so checks 2 and 3 have a key and a dial placed under the old names. Then build the branch, quit Stream Deck and open it again, since Stream Deck reads `manifest.json` only as it starts:

```shell
npm run build
```

## Checks

1. **The list follows the manifest.** Open the actions list and expand Litra: it offers, in this order, "Power", "Scene", "Set Brightness", "Brightness Up", "Brightness Down", "Set Temperature", "Temperature Up" and "Temperature Down". Share a screenshot of the list.
2. **A key placed before keeps working.** Select the Brightness key placed from `main`: its settings page names it "Set Brightness", and still shows its preset. Press it: the lamp goes to its preset, and `logs/litra.log` has a `Set Brightness: Key pressed` line.
3. **A dial placed before shows its new title.** The Brightness dial placed from `main` shows "Set Brightness" at the top of its strip, whole, above the icon and the value. Turn it: the lamp's brightness follows.
4. **A new dial's title fits.** Drag a Set Temperature action onto a dial: its strip shows "Set Temperature" whole at the top, as long a title as the plugin sets. Share a photo of the strip.
5. **Every value shows its unit.** Set a Set Brightness key to 70% and a Set Temperature key to 6500 K, and place the four step keys. The Set keys show "70%" and "6500 K", whole, at the bottom of the key. Press both Set keys: Brightness Up and Down show the lamp's %, "70%", or its cap when it's lower, Temperature Up and Down "6500 K", and the dials' main screens the same values with the same units. Share a photo of the keys.

[#236]: https://github.com/daczarne/streamdeck-litra/issues/236
