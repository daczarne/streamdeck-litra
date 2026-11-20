# Testing

- [What runs where](#what-runs-where)
- [What a test stands on](#what-a-test-stands-on)
  - [Fakes](#fakes)
  - [Emulated lamps](#emulated-lamps)
  - [Every model the lamps can be](#every-model-the-lamps-can-be)
- [Each layer's tests](#each-layers-tests)
  - [The lamps](#the-lamps)
  - [The settings](#the-settings)
  - [The controls](#the-controls)
  - [The actions](#the-actions)
  - [The integration tests](#the-integration-tests)
  - [The scripts](#the-scripts)
- [The browser tests](#the-browser-tests)
- [Writing a test](#writing-a-test)

This document describes how the plugin's tests are written: what each kind covers, what stands in for Stream Deck, `node-hid` and the lamps, and how a test is laid out. What a change has to bring with it is in "Features ship with tests" in [the contributing guide][contributing], and how the parts the tests cover fit together in [the architecture document][architecture].

## What runs where

- `npm test` runs the unit tests and the integration tests with Vitest, from `vitest.config.mjs`: every `*.test.ts` in `src/` and `scripts/`, the unit tests next to the file they test, and the integration tests in `src/integration/`. They need nothing installed and no lamp plugged in, and create no `logs/` folder. `npm run coverage` runs the same tests, with a report of what they cover.
- `npm run test:browser` runs the browser tests, in `browser-tests/`, from `vitest.browser.config.mjs`, apart from the others, since they need Chrome (see [The browser tests](#the-browser-tests)).
- What only the Deck and the lamps can prove is checked by hand, following [the manual checks][manual-testing], one document per area. Each one starts by saying what the automated tests already cover, so its checks cover only what they take for granted.

CI runs both suites on every pull request, the browser tests in a job of their own.

The config sets `mockReset`, so every mock starts each test afresh, with no calls recorded and no answer left from the test before. A test gives a mock what it should answer in a `beforeEach` or in the test itself.

## What a test stands on

A unit test covers one module, with what it builds on replaced, so the test needs no Stream Deck and no lamp, and nothing it does reaches them. What stands in for the real thing is named for what it stands in for (see "Features ship with tests" in [the contributing guide][contributing]): a fake for software, and an emulated device for hardware. What several tests share is in `src/test-support/`, and what one test needs alone, in that test.

A test replaces a module with `vi.mock`, at the top of its file, pointing it at a shared fake or giving the functions it needs as mocks:

```ts
vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));
vi.mock("../logging", () => import("../test-support/fake-logging"));
vi.mock("../lamps/manager", () => ({ onLampsChanged: vi.fn(), setLampsBrightness: vi.fn() }));
```

### Fakes

- `fake-stream-deck.ts` stands in for `@elgato/streamdeck`, which opens a connection to Stream Deck and creates a `logs/` folder on import. It gives the actions the SDK's base class, which reports the keys and dials a test has placed, and its decorator, which gives the class the id it's registered under, as the SDK's does. It also gives fake keys and dials, which record what the plugin tells them to show, and an entry point that records the actions registered, connects to nothing and, like the SDK, refuses an action whose id `manifest.json` doesn't list. It carries the settings pages' messages too: a test sends the plugin what a page sends (`sendToPlugin`), reads what the plugin sent the pages (`sentToPropertyInspector`), and saves the global settings as a page does (`changeGlobalSettings`).
- `fake-deck.ts` holds `FakeDeck`, which stands in for Stream Deck sending a key's or a dial's events: it places keys and dials, presses, turns, pushes, taps and holds them, and changes their settings, sending each event to the action it belongs to, by its id in the manifest. It runs on Vitest's fake timers, and each interaction waits for everything it set off, timers included, such as a dial's debounce, a brightness that settles, or a blink. Within `quickly`, the interactions go back to back, as when a dial is turned fast, and the waiting comes after the last.
- `fake-logging.ts` stands in for `src/logging.ts`, which writes to a `logs/` folder. Every scope logs to the same mocks, so a test checks what was logged without knowing which scope logged it.
- `fake-node-hid.ts` stands in for `node-hid`, which loads its native binary on import and would reach the lamps plugged into the computer. It lists and opens the emulated lamps a test plugs in with `connect`, records every call made on them, which `hidEvents` returns and `forgetEvents` clears, and can fail to find the lamps (`failFindingLamps`).
- `reached-lamps.ts` builds `Lamp`s as an operation leaves them, for the tests of what the Deck shows, which need no lamp: each is reached through a handle that only answers the state it's given.

A test that needs a fake of its own declares it: `lamp.test.ts` gives a `Lamp` a `FakeHandle`, a lamp opened for an operation that keeps its state, records what it's written and fails the reads it's told to, and `measure.test.ts` tests `MeasureAction` through `FakeMeasureAction` (see [The controls](#the-controls)).

### Emulated lamps

`emulated-litra.ts` holds `EmulatedLitra`, a Litra lamp without hardware, as the probes in `scripts/probes/` measured the Beams and the Beam LX. It keeps its power, brightness and temperature, carries out the reports written to it, and answers on every handle open on it, as a lamp does:

- A query gets a reply with the value, every write an ACK, even one that changes nothing, and a report it can't carry out an error report.
- It answers HID++ 2.0's Root feature, and gives its serial number through Device Information, which a Beam LX, whose USB descriptor gives none, is asked for.
- A Beam LX turns on at the setting it saved shortly after it was last switched off, and loses a setting written while it's off.
- A capped lamp, like a Beam on a Stream Deck + XL's hub, takes a brightness above its cap, then lowers it to the cap with a change notice, refuses more while at it, and goes back to its cap a second later, undoing a lower brightness written in between.
- A test can make a call on its handles fail (`fail`), or the writes of one command (`failWrites`), as an HID error does.

A lamp a test makes without a serial number gets one whose id rises with each lamp, numbered afresh for every test, so a test's lamps come in the order it makes them, as the plugin orders them by id.

A test that runs `litra` loads the code under test through `emulated-lamps.ts`, in a `beforeEach`, rather than importing it at the top of its file. `loadOnEmulatedLamps` loads it afresh, with `node-hid` and the logger replaced by `vi.doMock` after `vi.resetModules()`, so nothing is left from an earlier test, such as a cap learned or a listener registered. `vi.mock` wouldn't do, since a module it mocks outlives the reset, and the code would keep the first test's fakes. It fails when `litra` didn't get the fake `node-hid`, since the test would then write to the lamps plugged in. `vitest.config.mjs` makes that possible: it points `litra` at its ESM build, the one the plugin bundles, and has Vitest load it, since a mock can't reach the CommonJS build's `require` of `node-hid`.

### Every model the lamps can be

The Beam LX differs from the Beam where the plugin has to help it, such as its serial number and how it turns on, so the tests that run the lamp manager on emulated lamps, `src/lamps/manager.test.ts` and `src/integration/actions.test.ts`, run twice, as the projects `Beam` and `Beam LX` of `vitest.config.mjs`. Their lamps are of the run's model, which they take with `inject("model")`, unless a test is about one model on its own. Every other test file runs once, as `once`.

## Each layer's tests

### The lamps

- `lamp.test.ts` checks a `Lamp` on its own, through a fake handle, with no lamp: what it sends, what it remembers, such as its cap, and how it converts within its range.
- `connection.test.ts` runs `LampConnection` on emulated lamps, and checks how it finds them, names them, and reads what `litra` doesn't, such as a brightness from two bytes.
- `manager.test.ts` runs the real `litra` on emulated lamps, on both models, and checks what reaches each lamp and in what order, and the `Lamp`s an operation leaves. Its `connect` reaches the lamps never reached, as the plugin does when it starts, and forgets what that wrote and logged, so each test sees only its own operation.

### The settings

- `schemas.test.ts` checks each setting's default, the values it takes, and the warning for a value it doesn't.
- `global-settings.test.ts` gives `GlobalSettings` a fake save, and checks what it reads, answers and saves. Its sync tests replace the SDK's settings.
- `plugin-settings-page.test.ts` checks how the plugin answers the plugin settings page, with the SDK's messages, the lamp manager and the global settings replaced.

### The controls

An abstract class is tested on its own, through a fake subclass its test declares, so what the tests check holds for every implementation, and they import none of them. `measure.test.ts`, for example, tests `MeasureAction` through `FakeMeasureAction`, with fakes for what an action built on it gives it, what it steps and shows, and `preset-key.test.ts` tests `PresetKeyAction` the same way. Each action built on it then has its own tests, next to it (see [The actions](#the-actions)).

`shown.test.ts` builds the `Lamp`s an operation leaves with `reached-lamps.ts`, and checks what the keys and dials show of them. The other controls, such as the lamp screens, the debouncer and the text styles, are tested with what they build on replaced, as any unit.

### The actions

An action's test replaces the SDK, the logger, the lamp manager and, where it's in the way, what the Deck shows (`src/controls/shown.ts`) and the debouncer, with mocks whose answers each test sets. It drives the action through a `FakeDeck`, and checks the operations it asks the lamp manager for, and what each key or dial was told to show. Each action has its own test file, with at least a contract test that creates it and checks its defaults, even when what it does comes from the class it's built on.

### The integration tests

The integration tests, in `src/integration/`, cross modules with nothing between them replaced:

- `litra.test.ts` runs `litra` on emulated lamps of every model, and checks its protocol, as the plugin relies on it.
- `actions.test.ts` starts `plugin.ts` afresh for every test, through `loadOnEmulatedLamps`, and drives the actions it registers through a `FakeDeck`, down the real lamp manager to emulated lamps, on both models. After every test, it checks that every handle the plugin opened is closed.

An integration test that crosses nothing the unit tests don't already cross goes, and one that checks the same behavior from the user's side stays (see "Features ship with tests" in [the contributing guide][contributing]).

### The scripts

The tests of `scripts/check-ui.mjs` and `scripts/check-docs.mjs` run each script with Node, as CI does, in a temporary folder that holds the files it checks (`script-folder.ts`), and check its exit code and output. `scripts/package-files.mjs`'s tests call its functions on a temporary `node_modules`.

## The browser tests

The browser tests load each settings page from the plugin folder in a headless Chrome, which `browser-tests/support/chrome.ts` drives over a pipe rather than a debugging port, so nothing else on the computer can connect to it. `browser-tests/support/fake-stream-deck.ts` stands in for Stream Deck's WebSocket, and for the plugin behind it: it keeps the global settings a page reads and saves, answers a page that asks for the lamps, which ones are connected, or renames or forgets one, and can tell a page which lamps are connected, or send it an action's settings, as Stream Deck does when they're saved elsewhere.

They check each page under its Content-Security-Policy, which refuses anything remote and any inline script or style, the controls each page shows, that each control's default and values are the ones `src/settings/schemas.ts` takes, the settings it sends, its own and the plugin's global ones, and the pages' scripts, such as the lamp picker and the number fields. Chrome is found at `CHROME_PATH`, or where macOS or Linux usually install it.

## Writing a test

- A test file has a `//* Fakes` section, with its mocks and the helpers that set them up, and a `//* Tests` section, with a `describe` for each function or class it tests.
- A test's name says what the code does, as a sentence a reader understands without the code.
- Each test sets up what it needs, and checks the outcome a user or the next module sees: what a key or a dial shows, what reached a lamp, what was returned and logged. It doesn't check how the code got there.
- An element of an array is read with `at` from `src/test-support/at.ts`, which fails the test when it's missing, rather than with `!`.
- An icon a dial sends is checked against `iconIn` from `src/test-support/icons.ts`, which draws it on its own, rather than with the plugin's `iconOf`.
- A bug the tests find, which the branch doesn't fix, gets an `it.fails` test stating the intended behavior, linked to its issue. Once the bug is fixed, Vitest reports it as a failure, and it becomes a normal test.
- Helpers have doc comments, like every function, which `npm run check:docs` checks (see [the style guide][style-guide]).

[architecture]: architecture.md
[contributing]: ../contributing.md
[manual-testing]: manual_testing/
[style-guide]: style_guide.md
