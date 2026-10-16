---
name: pr-description
description: Use in this repository when asked for the pull request text, in any wording (for example "prepare the PR documentation", "write the PR description", "PR title and body"). Writes the title and description of the current branch's pull request from its net change and the purpose discussed in the conversation, and returns them as two Markdown blocks ready to paste. Only on request, once the feature is done and reviewed.
allowed-tools: Bash(git diff *), Bash(git log *), Bash(git status *)
---

# Pull request title and description

Pull requests are squash-merged, so their title and description become the commit on `main`: they are the history of the repository. They are written for someone reading that history later, who never saw the conversation.

## Gather

1. **Net change.** Run `git diff --merge-base main --stat`, then read the diff of the files that matter. Describe the final state of the branch, not the path to it: iterations and reverted attempts are left out.
2. **Commits.** Use `git log --oneline main..HEAD` only for context.
3. **Uncommitted work.** Run `git status --short`. Anything uncommitted is not part of the pull request: point it out above the blocks and ask whether it belongs in the branch.
4. **Purpose.** Take the why, the problem the branch solves, from the conversation. When the branch works on an issue, read the issue too: it is the main source of the why. Most branches don't start from an issue, and then the conversation is enough.

## Title

- Says what changes, as a verb in the third person present, like the history on `main` (for example "Adds unit tests for litra-manager").
- At most 72 characters, no final period, and no PR number (GitHub appends it on merge).

## Description

Follow the Markdown section of `docs/style_guide.md`, with one exception: the pull request title is the document's H1, so the description has neither an H1 nor a table of contents.

1. **Opening paragraph, without a heading.** What the branch changes and why, in a few sentences.
2. **`##` sections by area** (for example "Configuration", "Tests and CI", "Documentation"), when the branch spans several parts of the code base. Each section stands on its own, so it can become the description of a separate pull request if the branch is split. A change to one part needs no sections, just the opening paragraph and, if useful, a list.
3. **Summarize, don't restate.** Say what each change does for the repository, not what the changed files contain: the reviewer reads those in the diff. When a file is itself prose (a doc, a skill, a command), name it and state its purpose in one sentence.

The length follows the pull request. A short or simple change gets a short description. A long one, or one that touches critical parts of the repository, gets a more thorough one.

The description covers what the branch does, not how it was decided. Background and rejected alternatives belong in GitHub issues and their discussions. The one exception is a short note when the branch departs from the usual way of doing something, saying why. Work left for later is not mentioned either: it is tracked as its own issue.

Don't refer to the conversation or to who asked for what ("as discussed", "as requested"). State the reasons themselves.

## Output

Return only the two blocks, the title first, each in a ```` ```markdown ```` fence. When the description itself contains a code fence, fence it with four backticks so the inner one survives. Don't write them to a file, and don't run `gh`.
