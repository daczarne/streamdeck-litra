# Property Inspector

- [How Stream Deck loads a page](#how-stream-deck-loads-a-page)
- [Talking to the plugin](#talking-to-the-plugin)
- [Global settings](#global-settings)
- [Content-Security-Policy](#content-security-policy)
- [Debugging a page](#debugging-a-page)
- [Sources](#sources)

An action's settings page is its Property Inspector: an HTML page from the plugin folder, which Stream Deck shows when the action is selected. This document collects what was learnt about how Stream Deck loads and runs these pages, so that a change to them can be tested without rediscovering it.

## How Stream Deck loads a page

- Stream Deck renders the pages with Qt WebEngine, which is Chromium. A page that works in Chrome generally works there too.
- A plugin's page loads from `file://`, at its path in the plugin folder. For this linked plugin, that's the repository: `file:///Users/.../streamdeck-litra/com.daczarne.litra.sdPlugin/ui/temperature.html`. Stream Deck also registers its own `sdpi:` scheme, but uses it for its own panels (`sdpi://ui`), not for plugins' pages.
- Only the page of the selected action exists. Selecting another action replaces it with a new page.
- A manifest names a page per action, or one at its top for every action that names none (`PropertyInspectorPath`), and nothing else: Stream Deck 7.6 has no page for a plugin's own settings, such as under Preferences > Plugins. Checked in `@elgato/schemas` and in the manifest keys the app's binary reads. The plugin settings ([#146]) are therefore a view that every action's page shows, from one script.
- Stream Deck calls a global function on the page, `connectElgatoStreamDeckSocket`, with a port and the action's details, including whether it sits on a key or a dial. The page then opens a WebSocket to `ws://localhost:<port>`, through which it reads and saves the settings. sdpi-components defines that function, so the pages here don't.
- sdpi-components sets its font and its colors on its own elements, as custom properties such as `--font-family` and `--input-font-color`, so an element a page adds outside them, such as the plugin settings' table, the messages about the lamps and the section headings, takes the browser's defaults, a dark serif, unless the page's CSS writes them out. The plugin settings set the font once, on their container.

## Talking to the plugin

A page and the plugin exchange messages through Stream Deck, which the lamp picker on the keys' pages ([#20]) and the plugin settings on every page ([#146]) rely on:

- A page sends `sendToPlugin` over its WebSocket, with a payload of its own. The plugin receives it through `streamDeck.ui.onSendToPlugin`, whichever action the page belongs to, so one listener can answer every page. `streamDeck.ui.sendToPropertyInspector` answers, and only reaches the page that's shown.
- sdpi-components' `SDPIComponents.streamDeckClient.get(…)` sends a message and waits for the reply that matches it. Its `datasource` attribute fills a select or a checkbox list the same way, but a checkbox list's items are only a checkbox and a label, so they can't hold a button.
- `SDPIComponents.useSettings(key)` reads and saves one setting while keeping the others, for a page script that draws its own controls. sdpi-components' checkbox and button work there as plain elements: without a `setting`, a checkbox saves nothing itself.

## Global settings

Besides each key's and dial's own settings, a plugin has one set of global settings, which every action shares, and Stream Deck keeps across restarts. The lamp screens' blink is one ([#144]): every dial's, and the dials that chose otherwise. Whether the lamps keep their difference when a dial or a step key steps them are two more ([#145]), how long a blink lasts another ([#171]), and what each cell of the lamp screens shows six more, with how each shows it, kept by cell and by item, one more ([#177]). The lamp screens' four text styles are twelve more, a color, a weight and a size each ([#153]). The lamps' names are another ([#146]), which the lamp screens read too ([#177]):

- On a page, a sdpi-components control with the `global` attribute reads and saves a global setting instead of one of the action's. It asks Stream Deck for them (`getGlobalSettings`) when the page loads, and holds every save until the answer arrives. A save sends them whole (`setGlobalSettings`), keeping the ones the page doesn't show.
- A control with `global` only gets the global settings that arrive once it's on the page: it doesn't ask for them itself. One added later, such as when a view opens, shows its default until another answer arrives. The plugin settings therefore put their checkboxes, lists, color pickers and slider on the page as it loads, hidden ([#146]).
- The plugin reads them with `streamDeck.settings.getGlobalSettings()`, which waits for the connection to Stream Deck, and follows a page's changes with `streamDeck.settings.onDidReceiveGlobalSettings`. Since Stream Deck 7.1, the listener isn't called for the plugin's own reads. Its event holds the settings as `settings`, not `payload.settings` as an action's does.
- `SDPIComponents.useGlobalSettings(key)` does for a page script what `useSettings` does for the action's. A save from the page doesn't reach the page's other readers of that key, which only hear from Stream Deck's answers, so the plugin settings tell the lamp picker of a name changed through an event on the document.
- A setting nested in another, such as a lamp screen cell's options, is out of the reach of a control with `global`, which saves a setting whole. The cells' editors use controls that save nothing themselves, and a script that reads and saves the options through `useGlobalSettings`. A list, a checkbox or a color picker reports a value set by a script as a change too, so the script keeps only the changes that differ from what it set ([#177]).
- A control with `global` saves a value a script gives it, as it saves the user's: setting its `value` is enough. Each text style's Reset button sets its controls back to their `default` attributes that way, so the defaults are written once, in the controls ([#153]).
- A checkbox saves `true` or `false`. Its `default` attribute is text, so `default="false"` would check it: a checkbox that starts unchecked has none, and an unsaved setting reads as missing.
- sdpi-components' checkbox has no indeterminate state, and draws its box inside its shadow DOM, out of a page's reach. The plugin settings draw their own for every dial's blink, with the same size, colors and check mark. A checkbox also reports a value set by a script as a change, so a script that sets one keeps only the changes that differ from what it set.

## Content-Security-Policy

A policy declared in a `<meta http-equiv="Content-Security-Policy">` is enforced. With the policy described in the "Settings pages" section of `README.md`, the pages load and save their settings, while a `fetch` or a `WebSocket` to a remote address from a page's console is refused.

- `'self'` matches the files of the plugin folder, since the page itself loads from `file://`.
- The directives can sit on separate lines inside the `content` attribute: the line breaks are whitespace to the policy.
- A blocked script or style leaves no trace on the panel itself, which just shows fewer controls or none, unstyled. The reason only shows in the page's console.

## Debugging a page

- Developer mode alone doesn't open the pages to DevTools. A separate preference, `html_remote_debugging_enabled` in `com.elgato.StreamDeck`, opens a debugging port on 23654. Stream Deck reads it when it starts.
- The port listens on `127.0.0.1` only, and has no authentication: while it's open, any process on the computer can run code in the pages.
- Each page is listed under its `<title>`, such as "Litra Temperature". The links on the port's own page, `http://localhost:23654/`, open a DevTools frontend served from `chrome-devtools-frontend.appspot.com`, whose connection to the port Chrome blocks (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). The DevTools behind `chrome://inspect` ship with Chrome and do connect.

The steps to open a page in DevTools, and the checks to run on it, are in [`manual_testing/settings_pages.md`][manual-test].

## Sources

Checked on Stream Deck 7.6, on macOS, while adding the Content-Security-Policy ([#9]):

- Qt WebEngine: the frameworks in `/Applications/Elgato Stream Deck.app/Contents/Frameworks/`, and the `QtWebEngineProcess` processes it runs, which register the `sdpi:` scheme.
- The preference and the port: strings in the `Stream Deck` binary (`html_remote_debugging_enabled`, `23654`), then `lsof` and the list of pages at `http://localhost:23654/json/list`, which gives each page's `file://` URL and its DevTools link.
- `connectElgatoStreamDeckSocket` and the WebSocket to `localhost`: the vendored `ui/vendor/sdpi-components.js`.
- The policy: each page's console in DevTools, and the panels on the Deck.

Checked while adding the lamp picker ([#20]): the messages and `useSettings` in the vendored `ui/vendor/sdpi-components.js` and in `@elgato/streamdeck/dist/plugin/ui.d.ts`, then the picker on the Deck, listing the lamps, saving them and blinking one.

Checked while adding the blink of each lamp as its lamp screen appears ([#144]): `useGlobalSettings`, the `global` attribute and the checkbox in the vendored `ui/vendor/sdpi-components.js`, and the plugin's side in `@elgato/streamdeck/dist/plugin/settings.js` and `events/global-settings-event.d.ts`, then the checkbox on the Deck, shared by both dials, followed by the plugin as it changed, and kept across a restart of the plugin and of Stream Deck.

Checked while adding the lamps' kept difference ([#145]): a page's save keeps the global settings it doesn't show, in the browser tests and on the Deck, with the brightness's and the temperature's saved from different pages and the blink from a third.

Checked while adding the plugin settings ([#146]): the manifest schema and the app's binary for a plugin-wide page, `useGlobalSettings` and `sdpi-textfield` in the vendored `ui/vendor/sdpi-components.js`, then the plugin settings on the Deck, on keys and dials, with names kept across a restart of Stream Deck.

Checked while adding the blink's length ([#171]): a slider with `global`, which saves a number to the global settings, in the browser tests and on the Deck, kept across a restart of the plugin.

Checked while adding the lamp screens' cells ([#177]): lists with `global`, made by a script with their options added before they're on the page, in the browser tests and on the Deck.

[#9]: https://github.com/daczarne/streamdeck-litra/issues/9
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
[#146]: https://github.com/daczarne/streamdeck-litra/issues/146
[#153]: https://github.com/daczarne/streamdeck-litra/issues/153
[#171]: https://github.com/daczarne/streamdeck-litra/issues/171
[#177]: https://github.com/daczarne/streamdeck-litra/issues/177
[manual-test]: ../manual_testing/settings_pages.md
