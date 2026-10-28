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
- Stream Deck calls a global function on the page, `connectElgatoStreamDeckSocket`, with a port and the action's details, including whether it sits on a key or a dial. The page then opens a WebSocket to `ws://localhost:<port>`, through which it reads and saves the settings. sdpi-components defines that function, so the pages here don't.

## Talking to the plugin

A page and the plugin exchange messages through Stream Deck, which the lamp picker on the keys' pages relies on ([#20]):

- A page sends `sendToPlugin` over its WebSocket, with a payload of its own. The plugin receives it through `streamDeck.ui.onSendToPlugin`, whichever action the page belongs to, so one listener can answer every page. `streamDeck.ui.sendToPropertyInspector` answers, and only reaches the page that's shown.
- sdpi-components' `SDPIComponents.streamDeckClient.get(…)` sends a message and waits for the reply that matches it. Its `datasource` attribute fills a select or a checkbox list the same way, but a checkbox list's items are only a checkbox and a label, so they can't hold a button.
- `SDPIComponents.useSettings(key)` reads and saves one setting while keeping the others, for a page script that draws its own controls. sdpi-components' checkbox and button work there as plain elements: without a `setting`, a checkbox saves nothing itself.

## Global settings

Besides each key's and dial's own settings, a plugin has one set of global settings, which every action shares, and Stream Deck keeps across restarts. The dials' blink of each lamp as its lamp screen appears is one ([#144]), and whether the lamps keep their difference when a dial or a step key steps them are two more ([#145]):

- On a page, a sdpi-components control with the `global` attribute reads and saves a global setting instead of one of the action's. It asks Stream Deck for them (`getGlobalSettings`) when the page loads, and holds every save until the answer arrives. A save sends them whole (`setGlobalSettings`), keeping the ones the page doesn't show.
- The plugin reads them with `streamDeck.settings.getGlobalSettings()`, which waits for the connection to Stream Deck, and follows a page's changes with `streamDeck.settings.onDidReceiveGlobalSettings`. Since Stream Deck 7.1, the listener isn't called for the plugin's own reads. Its event holds the settings as `settings`, not `payload.settings` as an action's does.
- A checkbox saves `true` or `false`. Its `default` attribute is text, so `default="false"` would check it: a checkbox that starts unchecked has none, and an unsaved setting reads as missing.

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

[#9]: https://github.com/daczarne/streamdeck-litra/issues/9
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
[manual-test]: ../manual_testing/settings_pages.md
