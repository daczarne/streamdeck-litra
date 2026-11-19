# src

The plugin's code, in layers, a folder each. Each folder imports only from the folders below it, so the frontend calls the backend, never the other way round:

1. [`actions/`][actions] (frontend): the plugin's actions, one module each.
2. [`controls/`][controls] (frontend): what the actions are built from, the keys and dials and what they display.
3. [`settings/`][settings] (backend): what Stream Deck keeps, and the plugin's side of the page that edits it.
4. [`lamps/`][lamps] (backend): the physical lamps, what the plugin holds of each one, and how it reaches them.

The frontend is the Deck: what its keys, dials and touch strip take in and display. The backend is the plugin's mechanics. The settings pages are a frontend of their own, in `com.daczarne.litra.sdPlugin/ui/`, which reaches the backend through `settings/`.

`plugin.ts` starts the plugin, and `logging.ts` holds the logger every module logs through, which any folder imports. The tests sit next to the module they test, while [`integration/`][integration] holds the tests that cross modules, and [`test-support/`][test-support] the fakes the tests share. [The architecture document][architecture] describes how the layers fit together, and [the testing guide][testing] how the tests are written.

[actions]: actions/README.md
[architecture]: ../docs/developer_guide/architecture.md
[controls]: controls/README.md
[integration]: integration/README.md
[lamps]: lamps/README.md
[settings]: settings/README.md
[test-support]: test-support/README.md
[testing]: ../docs/developer_guide/testing.md
