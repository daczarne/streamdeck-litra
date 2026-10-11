# Contributing

- [Changes go through pull requests](#changes-go-through-pull-requests)
- [Small pull requests](#small-pull-requests)
- [Commit messages and pull request text](#commit-messages-and-pull-request-text)
- [Features ship with tests](#features-ship-with-tests)
- [Dependencies](#dependencies)
- [Unused code](#unused-code)
- [Lamps are managed together](#lamps-are-managed-together)
- [Working with Claude](#working-with-claude)

This document describes how work on this repository is done: how changes reach `main`, how they are sliced and recorded, what each one has to bring with it, and the design rules that hold across the plugin. Style is covered separately, in [the style guide][style-guide].

## Changes go through pull requests

Nothing is pushed to `main`. Every change, however small, is made on its own branch and reaches `main` through a pull request, which is squash-merged. Pushing and merging are Daniel's.

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
- What can't be automated, such as Stream Deck's own behavior or what the lamps do, is checked by hand on the Deck. Those checks are written down in [`docs/manual_testing/`][manual-testing], one document per area, with when to run them and what each one should show, so that anyone can repeat them without remembering how. A feature that needs new manual checks adds them there, in the same pull request.
- A bug the tests find, which the branch doesn't fix, gets an `it.fails` test stating the intended behavior, linked to its own issue. When the bug is fixed, the test starts passing, which Vitest reports as a failure, and it becomes a normal test.

## Dependencies

Every dependency is pinned, and every upgrade is a deliberate change of its own.

- `package.json` declares exact versions only, never ranges. The project `.npmrc` sets `save-exact=true`, so `npm install <package>` records an exact version, and `ignore-scripts=true`, so no install runs install scripts.
- An upgrade is `npm install <package>@<version>`, followed by a review of the lockfile diff. Exact versions don't pin transitive dependencies, only the lockfile does, so it stays committed and installs use `npm ci`.
- GitHub Actions are pinned to full commit SHAs, with the version as a trailing comment, checked against the release tag ([#30]). Like npm packages, they're upgraded by hand. Dependabot was removed ([#40]) because no tests could check the upgrades it proposed.

## Unused code

Code or configuration that is unused, misleading or contradicts a decision already made is removed. For example, an entry relying on install scripts, now that `.npmrc` sets `ignore-scripts=true`, would contradict that decision even if it did nothing.

Two things are exceptions. They are unused today but kept on purpose, with their status documented:

- `ref/`, the original author's design notes and the Beam LX back-light research. It plays no part in the plugin.
- The build code for an installed plugin (`npm run pack` and `copyNativeRuntime` in `rollup.config.mjs`), in case the plugin is published one day ([#21]). Today it only runs linked.

## Lamps are managed together

The plugin has no way to control one lamp alone, so until per-lamp control arrives in [#20], it assumes the user wants every connected lamp kept in sync and controlled as one. Questions about several lamps are answered from that rule, not decided case by case: every lamp is sent the same value, and what an action displays describes the group. For example, when one lamp can't reach the requested brightness, the others still go there, and the dial shows the brightest lamp ([#13]). The lamp screens ([#48]) are the one exception: each shows a single lamp, so lamps that are out of sync can be told apart, and pushing the dial there blinks that lamp alone, so it can be found. The blink leaves the lamp as it was, and every value set through the plugin still goes to every lamp.

When [#20] is worked on, the question changes: what would someone who controls each lamp separately need for the plugin to work for them?

## Working with Claude

- When Daniel asks for a command, Claude replies with the command and doesn't run it. Steps that change what the Deck runs or shows, like restarting the plugin, are Daniel's to run, while looking at the hardware.

[#9]: https://github.com/daczarne/streamdeck-litra/issues/9
[#13]: https://github.com/daczarne/streamdeck-litra/issues/13
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[#27]: https://github.com/daczarne/streamdeck-litra/issues/27
[#30]: https://github.com/daczarne/streamdeck-litra/issues/30
[#40]: https://github.com/daczarne/streamdeck-litra/pull/40
[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
[manual-testing]: manual_testing/
[style-guide]: style_guide.md
