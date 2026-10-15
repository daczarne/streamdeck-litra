---
description: Run every linter, fix formatting findings and report the rest
allowed-tools: Bash(markdownlint-cli2 *), Bash(cspell lint *), Bash(git grep *), Bash(npm run lint), Bash(npm run format), Bash(npm run typecheck), Bash(npm run validate)
---

# Lint

Run the linters from CI, from the repository root, in this order: those of the `lint` and `spell-check` jobs, then the type check, Biome and `npm run validate` from the `tests` job. The tests have their own command, `/test`, and `/ci` runs both.

1. `markdownlint-cli2 --config ".markdownlint.yaml" .`
1. `cspell lint --config ".cspell.json" --dot --no-progress .`
1. `npm run typecheck`, which checks the TypeScript and the build and check scripts.
1. `npm run lint`, which runs Biome on the TypeScript and JavaScript: its lint rules, formatting and import order.
1. `npm run validate`, which runs `check:ui`, the build and `streamdeck validate`.

Then check the length of Markdown headings, which no linter covers (see `docs/style_guide.md`). `git grep -n -P '^(?=.{81})#{1,6} ' -- '*.md'` lists every heading over 80 characters. Skip matches inside code blocks, where `#` starts a comment, and shorten the rest without changing their meaning. When a shortened heading is linked from a table of contents or another document, update those links too.

Formatting findings are fixed directly, without asking. Everything else is reported, never fixed on its own.

- markdownlint, cspell and the heading check only cover formatting and spelling. Fix everything they report.
- Biome's formatting and import order findings are fixed with `npm run format`. Its lint rules report problems in the code: report them.
- The type check and `npm run validate` report errors in the code, the settings pages or the manifest. Report them.

Rules for the fixes:

- Spelling: fix real typos in the source. Add genuine terms (tool names, settings keys, identifiers) to the `.cspell/` dictionary that matches their topic, in alphabetical order. Create a new dictionary only when no existing one fits, and register it in both `dictionaryDefinitions` and `dictionaries` in `.cspell.json`.
- Never silence a rule (`markdownlint-disable`, `cspell:disable`, a per-file ignore, a configuration change) without asking.

Re-run the checks after fixing. Finish with a short summary: what was fixed, and the findings that need a decision.
