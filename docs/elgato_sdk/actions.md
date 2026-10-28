# Actions

An action class gets its id from `@action({ UUID })`: the SDK's decorator gives its instances a `manifestId`. The plugin hands Stream Deck each action with `registerAction`, which throws when an action has no `manifestId`, or one that `manifest.json` doesn't list ("The action's manifestId was not found within the manifest"). A UUID mistyped in the code stops the plugin as it starts.

Once registered, an action receives only the events of the keys and dials whose `manifestId` is its own, and `SingletonAction.actions` lists only the visible keys and dials with that `manifestId`. So two actions never see each other's keys, and a Power action that updates "its" keys updates only the Power keys.

Stream Deck lists the actions from the manifest, not from the plugin, so an action in the manifest without a registered class is still offered in the app, and its events reach no code. That last part comes from how the two fit together, and hasn't been checked on the Deck.

The tests check both directions: `src/plugin.test.ts` compares the actions `plugin.ts` registers with the manifest's, and the fake SDK in `src/test-support/fake-stream-deck.ts` refuses an action the manifest doesn't list.

## Sources

`@elgato/streamdeck` 3.0.3:

- The decorator: `dist/plugin/actions/decorators.js`.
- `registerAction` and the routing of events: `dist/plugin/actions/service.js`.
- `SingletonAction.actions`: `dist/plugin/actions/singleton-action.js`.
