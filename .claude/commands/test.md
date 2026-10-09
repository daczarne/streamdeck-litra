---
description: Run the unit tests and report the failures
allowed-tools: Bash(npm test), Bash(npm test -- *)
---

# Test

Run the unit tests from CI's `tests` job with `npm test`, from the repository root. To rerun a single file while looking into a failure, pass it after `--` (`npm test -- src/litra-manager.test.ts`). The linters have their own command, `/lint`, and `/ci` runs both.

Failures are reported, never fixed on their own. A failing test means that either the code or the test is wrong, and choosing which one is a decision. For each failure, report the test's name, what it expected and what it got, and propose a fix that says which side it changes and why.

Vitest reports an `it.fails` test that starts passing as a failure too. Such a test documents a known bug, so it passing means the bug is fixed: propose turning it into a normal test, and point out the issue it links to.

Finish with a short summary: how many tests passed, and the failures that need a decision.
