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

Plug in a Beam. When the branch renames an action, place a key and a dial of it on the Deck before building the branch, from `main`, so checks 3 and 4 have them under the old name. Then build the branch, quit Stream Deck and open it again, since Stream Deck reads `manifest.json` only as it starts:

```shell
npm run build
```

## Checks

1. **The list follows the manifest.** Open the actions list and expand Litra: it offers, in this order, "Power", "Scene", "Set Brightness", "Brightness Up", "Brightness Down", "Brightness", "Set Temperature", "Temperature Up", "Temperature Down" and "Temperature". Share a screenshot of the list.
2. **Keys and dials take their own actions.** Drag "Set Brightness" or "Set Temperature" onto a dial: Stream Deck doesn't take it. Drag "Brightness" or "Temperature" onto a key: Stream Deck doesn't take it either. Each dial action's settings page shows its step and its lamp screens' blink, and each key's its preset and its lamps.
3. **A key placed before keeps working.** Select the key placed from `main`: its settings page names it by the new name, such as "Set Brightness", and still shows its settings. Press it: it does what it did, and `logs/litra.log` scopes its line by the new name, such as `Set Brightness: Key pressed`.
4. **A dial placed before shows its new title.** The dial placed from `main` shows its new name at the top of its strip, whole, such as "Brightness". Turn it: the lamp follows.
5. **A new dial's title fits.** Drag a Temperature action onto a dial: its strip shows "Temperature" whole at the top, as long a title as the plugin sets. Share a photo of the strip.
6. **Every value shows its unit.** Set a Set Brightness key to 70% and a Set Temperature key to 6500 K, and place the four step keys. The Set keys show "70%" and "6500 K", whole, at the bottom of the key. Press both Set keys: Brightness Up and Down show the lamp's %, "70%", or its cap when it's lower, Temperature Up and Down "6500 K", and the dials' main screens the same values with the same units. Share a photo of the keys.

[#236]: https://github.com/daczarne/streamdeck-litra/issues/236
