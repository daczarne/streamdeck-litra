# actions

The frontend's top layer: the plugin's actions, one module each, named after it. Each holds its action's class, which `@action` registers under the UUID the manifest gives it, and what's specific to that action, such as what the Brightness action sets and steps, or the Scene key's groups. What several actions share is in [`../controls/`][controls].

There are 8: `power.ts`, `brightness.ts`, `temperature.ts`, `scene.ts`, and the step actions, `brightness-up.ts`, `brightness-down.ts`, `temperature-up.ts` and `temperature-down.ts`. `../plugin.ts` registers every one of them.

[controls]: ../controls/README.md
