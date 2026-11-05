# Actions

- [Registering an action](#registering-an-action)
- [One object per action type, one per key or dial](#one-object-per-action-type-one-per-key-or-dial)
- [A key's or dial's id](#a-keys-or-dials-id)
- [Sources](#sources)

An action is what the user places on a key or a dial, from the list Stream Deck shows. This document describes how the plugin registers its actions, how the SDK hands them their keys' and dials' events, and what the plugin builds on it.

## Registering an action

An action class gets its id from `@action({ UUID })`: the SDK's decorator gives its instances a `manifestId`. The plugin hands Stream Deck each action with `registerAction`, which throws when an action has no `manifestId`, or one that `manifest.json` doesn't list ("The action's manifestId was not found within the manifest"). A UUID mistyped in the code stops the plugin as it starts.

Once registered, an action receives only the events of the keys and dials whose `manifestId` is its own, and `SingletonAction.actions` lists only the visible keys and dials with that `manifestId`. So two actions never see each other's keys, and a Power action that updates "its" keys updates only the Power keys.

Stream Deck lists the actions from the manifest, not from the plugin, so an action in the manifest without a registered class is still offered in the app, and its events reach no code. That last part comes from how the two fit together, and hasn't been checked on the Deck.

The tests check both directions: `src/plugin.test.ts` compares the actions `plugin.ts` registers with the manifest's, and the fake SDK in `src/test-support/fake-stream-deck.ts` refuses an action the manifest doesn't list.

## One object per action type, one per key or dial

Stream Deck sends the events of every key and dial of an action type to the one object registered for it, so a plugin registers one object per action type, however many keys use it. `registerAction` doesn't check that the object is a `SingletonAction`: it needs its `manifestId`, and calls the handlers it has, such as `onKeyDown`, each bound to the object. `SingletonAction` itself only adds the `actions` getter.

The SDK keeps an object of its own for each key and dial on screen, the `KeyAction` or `DialAction` that every event carries as `ev.action`: it creates it as the key or dial appears, and drops it as it disappears, along with the settings it cached for it. It sends a key's or dial's events, its settings changed on its page included, only while it holds that object, so a key or dial not on screen never gets an event. With the settings' legacy behavior off, the default, `onDidReceiveSettings` also leaves out the answers to `getSettings`, so it only reports a page's changes.

The plugin builds on this ([#198]): each action is a `RoutingAction` (`src/actions/action-instance.ts`), which creates an object of the plugin's own for each key or dial as it appears, an `ActionInstance`, drops it as it disappears, and hands it the events of its key or dial. No event of a key or dial can come before its instance, nor after it was dropped.

## A key's or dial's id

A key's or dial's id (`action.id` in the plugin, `actionInfo.context` on its settings page) lasts across restarts of the plugin and of Stream Deck, so it can be stored, as the lamp screens' blink stores the dials that chose otherwise ([#144]). It isn't the `ActionID` that the profile in `ProfilesV3/` saves for the action, nor its MD5. Stream Deck doesn't tell the plugin when an action is deleted, only when it leaves the screen, so an id stored this way outlives its dial.

## Sources

`@elgato/streamdeck` 3.0.3:

- The decorator: `dist/plugin/actions/decorators.js`.
- `registerAction` and the routing of events: `dist/plugin/actions/service.js`.
- `SingletonAction.actions`: `dist/plugin/actions/singleton-action.js`.
- The objects kept for the keys and dials on screen, and their settings: `dist/plugin/actions/store.js` and `dist/plugin/actions/cache.js`, which the listeners in `dist/plugin/actions/service.js` fill and empty.
- Which settings events reach an action: `dist/plugin/settings.js`.

Checked on Stream Deck 7.6: each dial's id, logged as it appeared, across a restart of the plugin and of Stream Deck. What the SDK keeps for each key and dial, and which events it sends, is read from its source.

[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[#198]: https://github.com/daczarne/streamdeck-litra/issues/198
