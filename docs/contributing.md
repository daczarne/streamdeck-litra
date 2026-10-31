# Contributing

- [Changes go through pull requests](#changes-go-through-pull-requests)
- [Small pull requests](#small-pull-requests)
- [Commit messages and pull request text](#commit-messages-and-pull-request-text)
- [Features ship with tests](#features-ship-with-tests)
- [Dependencies](#dependencies)
- [Unused code](#unused-code)
- [Supported lamps](#supported-lamps)
- [By default, lamps are managed together](#by-default-lamps-are-managed-together)
- [The plugin settings are laid out by reach](#the-plugin-settings-are-laid-out-by-reach)
- [The lamp screens' text styles are roles](#the-lamp-screens-text-styles-are-roles)
- [Working with Claude](#working-with-claude)

This document describes how work on this repository is done: how changes reach `main`, how they are sliced and recorded, what each one has to bring with it, and the design rules that hold across the plugin. How the plugin's parts fit together, and why, is in [the architecture document][architecture]. Style is covered separately, in [the style guide][style-guide].

## Changes go through pull requests

Nothing is pushed to `main`. Every change, however small, is made on its own branch and reaches `main` through a pull request, which is squash-merged. Pushing to the repository and merging are the maintainer's. `.github/CODEOWNERS` makes the maintainer the owner of every file, so a pull request from anyone else needs the maintainer's approval before it can be merged.

Branch names are flat kebab-case, without `/`: `settings-pages-csp`, not `feature/settings-pages-csp`.

## Small pull requests

Each pull request is small and focused on one thing, because large ones are hard to review. An issue doesn't have to be closed by a single pull request: it can take several, and work that grows beyond it becomes its own issue. For example, [#27] started with a first pull request of unit tests only, while logging and integration tests became issues of their own.

When work turns up that doesn't belong in the current branch, it becomes an issue instead of being added to the branch.

## Commit messages and pull request text

Since pull requests are squash-merged, their title and description become the commit on `main`. They are the history of the repository, so that's where the care goes: they are written for someone reading that history later, and an inaccuracy is fixed there.

Commit messages on a branch disappear in the squash. They stay short and accurate, but they aren't polished or rewritten after the fact.

## Features ship with tests

Every new feature or enhancement comes with automated tests for it. [#27] was a one-off catch-up, adding tests for code that had none. From [#9] on, new work brings its own.

- A feature and its tests come in the same pull request. Otherwise the branch that adds the feature can also add its bugs, typically in edge cases nobody tested.
  - Exceptions to this rule can be made when the tests that need to be added, also require new testing infrastructure. But even in these cases splitting the PR should be an exception (like in [#9]).
  - The issue isn't done until the tests are in.
- A unit test covers one module, with the modules it builds on faked, or the lamps emulated for the code that talks to them: its logic and its edge cases, such as invalid settings, logs and each kind of failure. An integration test covers what crosses modules: that what one module reports or sends reaches the next as that one expects, and sequences whose steps depend on each other. An integration test that crosses nothing the unit tests don't already cross goes. One that checks the same behavior from the user's side, across modules, stays, since the design that makes the two equivalent today can change.
- What can't be automated, such as Stream Deck's own behavior or what the lamps do, is checked by hand on the Deck. Those checks are written down in [`docs/manual_testing/`][manual-testing], one document per area, with when to run them and what each one should show, so that anyone can repeat them without remembering how. A feature that needs new manual checks adds them there, in the same pull request.
- A bug the tests find, which the branch doesn't fix, gets an `it.fails` test stating the intended behavior, linked to its own issue. When the bug is fixed, the test starts passing, which Vitest reports as a failure, and it becomes a normal test.

## Dependencies

Every dependency is pinned, and every upgrade is a deliberate change of its own.

- `package.json` declares exact versions only, never ranges. The project `.npmrc` sets `save-exact=true`, so `npm install <package>` records an exact version, and `ignore-scripts=true`, so no install runs install scripts.
- An upgrade is `npm install <package>@<version>`, followed by a review of the lockfile diff. Exact versions don't pin transitive dependencies, only the lockfile does, so it stays committed and installs use `npm ci`.
- The Node and the npm the plugin is built with are pinned in `devEngines` in `package.json`, and npm refuses to install or run a script with any other. They're in `devEngines` rather than `engines` because `engines` names the Node a package runs on, and the plugin runs on the one Stream Deck downloads, set by `Nodejs.Version` in the manifest. Node's version is also in `.node-version`, which `n` and CI read.
- npm is the one that ships with that Node, so `n` and CI install both together, and nothing installs npm on its own, outside Node's release. Upgrading Node moves npm in `devEngines` to the version the new Node ships, which its release notes list.
- A dependency installed from GitHub, such as `@daczarne/streamdeck-icons`, is pinned to a full commit SHA instead of a version. An upgrade is `npm install github:daczarne/streamdeck-icons#<commit>`, followed by `npm run icons` and a commit of the regenerated images with it, so the history records which glyphs they were built from. CI checks that the committed images match.
- `sharp`, which renders the icons, ships its image library, libvips, as a native binary, one optional dependency per platform, so its upgrades can't be reviewed from source in the lockfile diff. The diff still shows which packages changed and where they come from. An upgrade can change how the icons are drawn, such as their antialiasing, which the icons check reports: run `npm run icons`, look at what changed, and commit the regenerated images with the upgrade.
- Biome ships as a native binary, one optional dependency per platform, so its upgrades can't be reviewed from source in the lockfile diff. The diff still shows which packages changed and where they come from. Its type-aware rules, such as `noFloatingPromises`, are in its experimental nursery group, so an upgrade can change what they report: run `npm run lint` on the upgrade and look at what changed.
- `@elgato/utils`, whose logger the plugin uses, is also a dependency of `@elgato/streamdeck`. It's pinned to the version the SDK depends on, and upgraded with the SDK in the same change, so the plugin bundles a single copy.
- `@vitest/coverage-v8` requires Vitest's exact version, so it's pinned to the same one and upgraded with Vitest in the same change.
- An upgrade of `litra` is checked by the integration tests in `src/integration/litra.test.ts`, which run it against emulated lamps and compare the bytes it sends with those of `litra-rs`, another implementation of the protocol. An upgrade that changes the protocol, or fixes a bug the plugin works around, fails there, and each failing test says what to reconsider.
- GitHub Actions are pinned to full commit SHAs, with the version as a trailing comment, checked against the release tag ([#30]). Like npm packages, they're upgraded by hand. Dependabot was removed ([#40]) because no tests could check the upgrades it proposed.
- CI's runners are pinned to an Ubuntu release (`ubuntu-24.04`), not `ubuntu-latest`, which GitHub moves to a new release on its own schedule, with the tools its image comes with, such as the Chrome the browser tests drive. Moving to a newer release is an upgrade of its own.

## Unused code

Code or configuration that is unused, misleading or contradicts a decision already made is removed. For example, an entry relying on install scripts, now that `.npmrc` sets `ignore-scripts=true`, would contradict that decision even if it did nothing.

## Supported lamps

The Litra Beam is the plugin's target: it's what the plugin is checked on, and the tests, the fakes and the defaults use its real values. Other models are added one at a time, and a model is called supported once it has been checked on the lamp. The Beam LX comes next, front light first ([#100]), with its back light in [#19].

The Glow isn't planned. The plugin does for it whatever the code it shares with the Beams does, and nothing is built or checked for the Glow on its own. Changes for it are welcome from contributors who have one.

## By default, lamps are managed together

Unless the user picks a lamp, the plugin assumes they want every connected lamp kept in sync and controlled as one. Questions about several lamps are answered from that rule, not decided case by case: every lamp is sent the same value, and what an action displays describes the group. For example, when one lamp can't reach the requested brightness, the others still go there, and the dial shows the brightest lamp ([#13]), with its bar marking where the dimmer lamps stop ([#59]).

Per-lamp control ([#20]) comes in two places. Each key acts on the lamps picked on its settings page, every connected lamp unless others are picked, and what it shows describes those lamps. Each lamp screen ([#48]) shows a single lamp, so lamps that are out of sync can be told apart, and there, turning or pushing the dial acts on that lamp alone, and holding the strip blinks it, so it can be found, as can each tap that shows a lamp, on a dial whose blink is on ([#144]). The plugin settings turn the blink on or off for every dial, and a dial's own page for that dial alone. A dial's choice is kept in the global settings, by the dial's id, since the plugin only knows the dials on screen: kept with the dial, the plugin settings couldn't tell when the dials differ, nor give every dial the same again. A dial's main screen still acts on every lamp, and by default a turn there, or a step key's press, brings lamps set apart back in sync. A global setting for the brightness, and another for the temperature, keep them apart instead: each lamp steps from its own value, and one that reaches an end of its range or its cap stays there while the others keep going, then comes back with them, so the lamps keep their difference ([#145]). Lamps can be named in the plugin settings, which every page shows ([#146]). A name is the lamp's, kept in the global settings by lamp id, and the keys' lamp pickers show it. A setting that lets the user choose otherwise comes as its own issue, such as whether lamps plugged in later join a key's ([#147]).

While [#20] is worked on, the question changes: what would someone who controls each lamp separately need for the plugin to work for them?

## The plugin settings are laid out by reach

The plugin settings, which every settings page shows, hold settings of different reach: naming a lamp changes every key and dial, while a lamp screen's layout only changes the lamp screens. So the settings come in sections by what they reach, the widest first, and a setting goes in the section of what it reaches, not of what it resembles:

1. **Lamps**: the lamps themselves, whichever key or dial acts on them. The table of the lamps leads, since naming and identifying them is the plugin settings' first use, then how each lamp steps, and how long a blink lasts, for Identify and on the lamp screens.
2. **Dials**: every dial, first what applies to all of a dial, then its main screen, then its lamp screens, with their blink, their layout and their text styles ([#153]). The text styles are the lamp screens' because only the lamp screens use them, and would move up to all of a dial's if the main screens took them too ([#183]).
3. **Keys**, if a setting ever reaches only the keys, after the dials.

A section's parts with several settings get a heading, such as "Lamp screens". A part with a single setting is that setting's row label, such as "Brightness", until it grows a second one. A section or a part with no settings isn't shown: its heading comes with its first setting.

## The lamp screens' text styles are roles

Stream Deck lets each user pick the touch strip's background, which the plugin can't read, so no fixed look reads on every strip. The lamp screens' text takes its look from four styles, set in the plugin settings, which every dial shares ([#153]). Each is named for its role, not its look, so a user who restyles them keeps what each one means, and a text picks its style by what it says:

| Style     | Role                                          | Default look            | Used by default for |
| --------- | --------------------------------------------- | ----------------------- | ------------------- |
| Primary   | The text itself                               | White `#ffffff`         | Every text          |
| Secondary | Text that steps back, such as a state at rest | Dark grey `#202020`     | The power's "OFF"   |
| Accent    | Text that draws the eye, without a judgment   | Cyan `#4dd0e1`          | Nothing             |
| Alert     | Something wrong, which needs attention        | Bold soft red `#ff6b6b` | Nothing             |

Every style is 18 px by default, and Normal but for Alert, which is bold so it stands out even when its color is changed. Accent's cyan is far from Alert's red and Secondary's grey, and suggests neither a warning, as amber would, nor that all is well, as green would. Alert's red is the one the plugin settings show "No lamps found" in, so red means the same thing on the strip and in the panel. The defaults draw the lamp screens as they were before the styles: only Primary and Secondary are used until the user picks the others for a cell or a power state.

A text that the plugin itself would show in another style, such as a brightness held below what was asked, picks the style of its role, and comes as its own change: the styles don't change what the lamp screens show by default.

## Working with Claude

- When asked for a command, Claude replies with the command and doesn't run it. Steps that change what the Deck runs or shows, like restarting the plugin, are the user's to run, while looking at the hardware.

[#9]: https://github.com/daczarne/streamdeck-litra/issues/9
[#13]: https://github.com/daczarne/streamdeck-litra/issues/13
[#19]: https://github.com/daczarne/streamdeck-litra/issues/19
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#27]: https://github.com/daczarne/streamdeck-litra/issues/27
[#30]: https://github.com/daczarne/streamdeck-litra/issues/30
[#40]: https://github.com/daczarne/streamdeck-litra/pull/40
[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
[#59]: https://github.com/daczarne/streamdeck-litra/issues/59
[#100]: https://github.com/daczarne/streamdeck-litra/issues/100
[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
[#146]: https://github.com/daczarne/streamdeck-litra/issues/146
[#147]: https://github.com/daczarne/streamdeck-litra/issues/147
[#153]: https://github.com/daczarne/streamdeck-litra/issues/153
[#183]: https://github.com/daczarne/streamdeck-litra/issues/183
[architecture]: architecture.md
[manual-testing]: manual_testing/
[style-guide]: style_guide.md
