# actions

The frontend's top layer: the plugin's actions, one module each, named after it. Each holds its action's class, which `@action` registers under the UUID the manifest gives it, and what's specific to that action, such as what the Set Brightness key sets, what the Brightness dial steps, or the Scene key's groups. What several actions share is in [`../controls/`][controls].

There are 10, in the order the manifest lists them: `power.ts`, `scene.ts`, `set-brightness.ts` (Set Brightness), `brightness-up.ts`, `brightness-down.ts`, `brightness.ts` (Brightness), `set-temperature.ts` (Set Temperature), `temperature-up.ts`, `temperature-down.ts` and `temperature.ts` (Temperature). Every action but the two dials sits on keys alone. `../plugin.ts` registers every one of them.

[controls]: ../controls/README.md
