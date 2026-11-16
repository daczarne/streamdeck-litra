# controls

The frontend under the actions: what the actions in [`../actions/`][actions] are built from. Its modules import from `../settings/` and `../lamps/`, never from `../actions/`.

A control, here, is a key or a dial on the Deck, as an action places it: each one gets an instance of its own (`action-instance.ts`), which takes the control's events and draws what it shows. The SDK calls the kind of control a controller, a `Keypad` or an `Encoder`, and a placed one an action. On a settings page, "control" means something else: a field of sdpi-components', such as a checkbox or a slider.

1. `action-instance.ts`: `RoutingAction`, which every action is, and `ActionInstance`, each key's or dial's own.
2. `measure.ts`: what the Set Brightness and Set Temperature actions share, a key that sets a preset and a dial that steps its lamps.
3. `step-key.ts`: what the four step actions share.
4. `lamp-screens.ts`: a dial's lamp screens, one per lamp.
5. `debouncer.ts`: gathers a dial's ticks and a step key's presses.
6. `shown.ts`: what a key or a dial shows of its lamps, once the operations queued are done.
7. `describe-lamps.ts`: the lamps a key acts on, as its log line names them.
8. `text-styles.ts`: the lamp screens' text styles, as a layout's text takes them.

[actions]: ../actions/README.md
