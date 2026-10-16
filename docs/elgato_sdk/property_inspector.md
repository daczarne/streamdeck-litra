# Property Inspector

- [How Stream Deck loads a page](#how-stream-deck-loads-a-page)
- [Content-Security-Policy](#content-security-policy)
- [Debugging a page](#debugging-a-page)
- [Sources](#sources)

An action's settings page is its Property Inspector: an HTML page from the plugin folder, which Stream Deck shows when the action is selected. This document collects what was learnt about how Stream Deck loads and runs these pages, so that a change to them can be tested without rediscovering it.

## How Stream Deck loads a page

- Stream Deck renders the pages with Qt WebEngine, which is Chromium. A page that works in Chrome generally works there too.
- A plugin's page loads from `file://`, at its path in the plugin folder. For this linked plugin, that's the repository: `file:///Users/.../streamdeck-litra/com.daczarne.litra.sdPlugin/ui/temperature.html`. Stream Deck also registers its own `sdpi:` scheme, but uses it for its own panels (`sdpi://ui`), not for plugins' pages.
- Only the page of the selected action exists. Selecting another action replaces it with a new page.
- Stream Deck calls a global function on the page, `connectElgatoStreamDeckSocket`, with a port and the action's details, including whether it sits on a key or a dial. The page then opens a WebSocket to `ws://localhost:<port>`, through which it reads and saves the settings. sdpi-components defines that function, so the pages here don't.

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

[#9]: https://github.com/daczarne/streamdeck-litra/issues/9
[manual-test]: ../manual_testing/settings_pages.md
