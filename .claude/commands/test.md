---
description: Run the unit and integration tests and the browser tests, and report the failures
allowed-tools: Bash(npm test), Bash(npm test -- *), Bash(npm run test:browser), Bash(npm run test:browser -- *)
---

# Test

Run the tests from CI's `tests` job, from the repository root, in this order:

1. The unit tests and the integration tests, with `npm test`.
1. The browser tests, with `npm run test:browser`. They drive the settings pages in a headless Chrome, so they need Chrome installed. Run them even when the unit or integration tests fail.

To rerun a single file while looking into a failure, pass it after `--` (`npm test -- src/litra-manager.test.ts`). The linters have their own command, `/lint`, and `/ci` runs both.

Failures are reported, never fixed on their own. A failing test means that either the code or the test is wrong, and choosing which one is a decision. For each failure, report the test's name, what it expected and what it got, and propose a fix that says which side it changes and why. A browser test that fails because Chrome can't start is a problem with the machine, not with the pages: report it as such.

Vitest reports an `it.fails` test that starts passing as a failure too. Such a test documents a known bug, so it passing means the bug is fixed: propose turning it into a normal test, and point out the issue it links to.

Finish with a short summary: how many tests passed in each suite, and the failures that need a decision.
