---
description: Review the documentation against the whole branch and propose updates for what it made stale
allowed-tools: Bash(git diff *), Bash(git log *), Bash(git ls-files *)
---

# Review docs

Run once a feature is done, before its pull request. It reviews the net result of the branch, not its individual commits, so the iterations that led to the final version cost nothing.

1. **What changed.** Get the net change of the branch against `main`, including uncommitted work, with `git diff --merge-base main --stat`, then read the diff of the files that matter. Use `git log --oneline main..HEAD` only for context.
2. **Which docs.** List the tracked Markdown files with `git ls-files '*.md'`. This includes `CLAUDE.md` and the commands and skills under `.claude/`. Decide which ones are related to the change from their location, their headings, and a search for the names the diff touches (paths, commands, functions, settings). Read only the related ones in full.
3. **Find stale statements.** In each related doc, find what the branch made false, outdated or missing.
4. **Report.** For each doc, list the stale statement, why it is stale, and the proposed wording. Apply the changes once Daniel approves them.

Docs explain mechanisms and reasons. Don't propose inventories that repeat what the code states; an example is fine. Follow `docs/style_guide.md`.
