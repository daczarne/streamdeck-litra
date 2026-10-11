# Testing the settings pages

- [When to run these checks](#when-to-run-these-checks)
- [Opening a page in DevTools](#opening-a-page-in-devtools)
- [Checks](#checks)
- [Afterwards](#afterwards)

The browser tests (`npm run test:browser`) check every settings page on every pull request: the controls it shows on a key and on a dial, the settings it sends, the value shown next to each slider, and that its Content-Security-Policy refuses anything remote or inline. They run the pages in a headless Chrome, with a fake standing in for Stream Deck, so they take for granted what Stream Deck itself does:

- It enforces the policy, in its own Chromium, which is older than the Chrome the tests use.
- It tells each page whether its action sits on a key or a dial.
- It passes the settings a page sends on to the plugin.
- It draws the page in its own panel, whose width and fonts decide whether a slider and its value fit on one line. The tests check what the page shows, not how it looks.

The checks below cover only those four points, on the Deck. How Stream Deck does each of them is described in [`property_inspector.md`][property-inspector].

## When to run these checks

- After a Stream Deck update.
- After a change to the pages' policy, to how they lay out their controls, or to the vendored sdpi-components. An older Chromium may treat a directive or a script differently from the Chrome the tests use.

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

Selecting another action replaces the page, so the key and the dial each need their own click on **inspect**.

> [!WARNING]
> Don't use the links on `http://localhost:23654/`. They open a DevTools frontend served from `chrome-devtools-frontend.appspot.com`, which is remote code driving the debugging port, and Chrome blocks its connection anyway (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`). The DevTools behind `chrome://inspect` ship with Chrome.

## Checks

Stream Deck treats every page the same way, so one key and one dial are enough: a Brightness key and a Brightness dial, for example. Open each one's page in DevTools.

1. **Stream Deck enforces the policy.** On one of the two pages:
    - The console shows no red errors after the page loads. A Chromium that doesn't understand a directive of the policy says so there.
    - Pasting `fetch("https://example.com")` into the console logs a red `Refused to connect to ... because it violates the following Content Security Policy directive: "connect-src ws://localhost:*"`. Nothing goes out on the network, so this is safe with Wi-Fi on.
2. **Stream Deck tells each page where it sits.** The key's panel shows the preset (Brightness), and the dial's panel shows the step (Step).
3. **Stream Deck passes the settings on to the plugin.** A changed setting takes effect on the Deck: the key jumps to its new preset, and the dial turns by its new step.
4. **Each slider shows its value.** On both panels, the value sits right of the slider, on the same line, with its unit (75%, 5%). It follows the handle while it's dragged, and after selecting another action and coming back, the panel shows the saved value. Check the Temperature key too: its value is the widest (4000 K).

## Afterwards

Close the debugging port, then quit and reopen Stream Deck:

```shell
defaults delete com.elgato.StreamDeck html_remote_debugging_enabled
```

Remove `localhost:23654` from the targets in `chrome://inspect` too.

> [!WARNING]
> The port has no authentication: while it's open, any process on the Mac can connect to it and run code in the pages.

[property-inspector]: ../elgato_sdk/property_inspector.md
