# Testing the settings pages

- [When to run these checks](#when-to-run-these-checks)
- [Opening a page in DevTools](#opening-a-page-in-devtools)
- [Checks](#checks)
  - [Each panel](#each-panel)
  - [The policy](#the-policy)
- [Afterwards](#afterwards)

The settings pages (Property Inspector) run inside Stream Deck, which no automated test can drive. These checks confirm on the Deck what only Stream Deck can prove: that it loads the pages, enforces their Content-Security-Policy, and passes settings between the pages and the plugin. How Stream Deck does each of these is described in [`property_inspector.md`][property-inspector].

## When to run these checks

- After a change to a page in `com.daczarne.litra.sdPlugin/ui/`, to its policy, or to the vendored sdpi-components.
- After a Stream Deck update.

## Opening a page in DevTools

A page that hits its policy shows nothing wrong on the panel, apart from missing or unstyled controls. The reason only shows in the page's console, in DevTools.

1. Build the branch and restart the plugin, so the Deck runs the pages under test:

    ```shell
    npm run build
    npx streamdeck restart com.daczarne.litra
    ```

2. Open the debugging port, which developer mode alone doesn't, then quit and reopen Stream Deck:

    ```shell
    defaults write com.elgato.StreamDeck html_remote_debugging_enabled -bool YES
    ```

3. In Stream Deck, select the action to test, so its page exists.
4. In Chrome, open `chrome://inspect/#devices`, click **Configure…** next to **Discover network targets**, and add `localhost:23654`.
5. Under **Remote Target**, click **inspect** under the page's title, such as "Litra Temperature".

Selecting another action replaces the page, so each panel needs its own click on **inspect**.

> [!WARNING]
> Don't use the links on `http://localhost:23654/`. They open a DevTools frontend served from `chrome-devtools-frontend.appspot.com`, which is remote code driving the debugging port, and Chrome blocks its connection anyway (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). The DevTools behind `chrome://inspect` ship with Chrome.

## Checks

### Each panel

Place each action where the table says, and open its page in DevTools:

| Action      | Placed on | Controls shown                       |
|-------------|-----------|--------------------------------------|
| Power       | Key       | Mode: Toggle, On or Off              |
| Brightness  | Key       | Brightness %, a slider from 0 to 100 |
| Brightness  | Dial      | Step %                               |
| Temperature | Key       | Temperature K, a slider              |
| Temperature | Dial      | Step K                               |

On each one:

1. The console shows no red errors after the page loads.
2. The panel shows the controls in the table, and only those: a key shows no step, a dial no preset.
3. A changed setting takes effect on the Deck: a key jumps to its new preset, a dial turns by its new step. A setting reaches the plugin only through the page's WebSocket to Stream Deck, so this also shows that the policy lets that connection through.

### The policy

All the pages declare the same policy, so checking it on one of them is enough. Paste these lines into the page's console, one at a time:

```js
document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
fetch("https://example.com")
new WebSocket("wss://example.com")
```

- The first prints the policy, with `\n` where the page breaks its lines.
- The second and the third each log a red `Refused to connect to ... because it violates the following Content Security Policy directive: "connect-src ws://localhost:*"`. The WebSocket ends with `readyState: 3`, closed without ever connecting.

Nothing goes out on the network, so these lines are safe to run with Wi-Fi on. The checks also replace testing with Wi-Fi off: anything remote that a page tried to load would show in its console as a refused request.

## Afterwards

Close the debugging port, then quit and reopen Stream Deck:

```shell
defaults delete com.elgato.StreamDeck html_remote_debugging_enabled
```

Remove `localhost:23654` from the targets in `chrome://inspect` too.

> [!WARNING]
> The port has no authentication: while it's open, any process on the Mac can connect to it and run code in the pages.

[property-inspector]: ../elgato_sdk/property_inspector.md
