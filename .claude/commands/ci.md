---
description: Run every check from CI, the linters and then the tests
allowed-tools: Read(.claude/commands/*), Bash(markdownlint-cli2 *), Bash(cspell lint *), Bash(git grep *), Bash(npm run lint), Bash(npm run check:docs), Bash(npm run format), Bash(npm run typecheck), Bash(npm run validate), Bash(npm test), Bash(npm test -- *), Bash(npm run test:browser), Bash(npm run test:browser -- *)
---

# CI

Run every check from CI locally, in two parts:

1. The linters, following `.claude/commands/lint.md`, including its fixes of formatting findings.
1. The unit and integration tests and the browser tests, following `.claude/commands/test.md`.

Run the tests even when the linters report findings, so that one run shows everything CI would.

Finish with a single summary covering both parts: what was fixed, how many tests passed, and the findings and failures that need a decision.
