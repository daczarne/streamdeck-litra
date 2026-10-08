---
description: Run the same checks as CI, fix formatting findings and report the rest
allowed-tools: Bash(markdownlint-cli2 *), Bash(cspell lint *), Bash(git grep *), Bash(npx tsc --noEmit -p .), Bash(npm test), Bash(npm run validate)
---

# Lint

Run the checks from the CI `build`, `lint` and `spell-check` jobs, from the repository root, in this order:

1. `markdownlint-cli2 --config ".markdownlint.yaml" .`
1. `cspell lint --config ".cspell.json" --dot --no-progress .`
1. `npx tsc --noEmit -p .`
1. `npm test`, which runs the unit tests.
1. `npm run validate`, which runs `check:ui`, the build and `streamdeck validate`.

Then check the length of Markdown headings, which no linter covers (see `docs/style_guide.md`). `git grep -n -P '^(?=.{81})#{1,6} ' -- '*.md'` lists every heading over 80 characters. Skip matches inside code blocks, where `#` starts a comment, and shorten the rest without changing their meaning. When a shortened heading is linked from a table of contents or another document, update those links too.

Formatting findings are fixed directly, without asking. Everything else is reported, never fixed on its own.

- markdownlint, cspell and the heading check only cover formatting and spelling. Fix everything they report.
- The type check, the tests and `npm run validate` report errors in the code, the settings pages or the manifest. Report them.

Rules for the fixes:

- Spelling: fix real typos in the source. Add genuine terms (tool names, settings keys, identifiers) to the `.cspell/` dictionary that matches their topic, in alphabetical order. Create a new dictionary only when no existing one fits, and register it in both `dictionaryDefinitions` and `dictionaries` in `.cspell.json`.
- Never silence a rule (`markdownlint-disable`, `cspell:disable`, a per-file ignore, a configuration change) without asking.

Re-run the checks after fixing. Finish with a short summary: what was fixed, and the findings that need a decision.
