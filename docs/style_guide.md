# Style guide

- [How to use this guide](#how-to-use-this-guide)
- [General](#general)
  - [Lines and indentation](#lines-and-indentation)
  - [Comments](#comments)
  - [Spelling](#spelling)
- [Markdown](#markdown)

## How to use this guide

This guide collects the conventions that the linters do not enforce, or only enforce partially. Where a tool does enforce a rule, its configuration is the source of truth and is not repeated here:

| Tool          | Configuration                                        |
|---------------|------------------------------------------------------|
| EditorConfig  | `.editorconfig`                                      |
| Biome         | `biome.json`                                         |
| Markdown lint | `.markdownlint.yaml` and `.markdownlint-cli2.yaml`   |
| CSpell        | `.cspell.json` and the dictionaries under `.cspell/` |

This guide and the tool configurations above are the authority on style. Code that doesn't follow them is wrong and is fixed to match. When the fix only touches formatting, it is made without asking.

A rule can still need amending when new code brings a situation it doesn't address: no rule covers the case, or following the rule as written would make the code worse (restructuring it, adding workarounds, or hurting readability). Then the code is not bent to fit. It is written plainly, the conflict is raised, and an amendment to this guide is proposed. **The guide changes by being amended, NEVER by code quietly disagreeing with it.**

## General

### Lines and indentation

Lines are at most 120 characters, except in Markdown (see [Markdown](#markdown)), with LF line endings, UTF-8 and a final newline.

Indentation is 2 spaces, except for Python and TOML, which use 4 (not relevant to this project).

### Comments

We use the [Better Comments][better-comments] extension to differentiate between types of comments. A marker is written right after the language's comment character: `#*` or `#!` in Python, `//*` or `//!` in JavaScript.

Not every marker has an agreed meaning yet, and new ones can be added. The meanings reserved so far are:

- No marker: explains the code (see below).
- `*`: step and section headers.
- `!`: warnings.

Linters usually require a space after the comment character (ruff's `E265`, for example). Such rules are disabled here because it would reject markers like `#*`, but its principle still applies, with the marker counted as part of the comment character: `#* Step`, `#! Warning`.

Comments explain intent and stay general. They don't repeat specifics the code already states (which files, which values, which paths), because such comments go stale the moment the code changes and nobody remembers to update them. They should, however, explain the mechanics of non-obvious code. Code that is hard to read is refactored first. If it can't be, it gets a comment explaining what it is expected to do.

### Doc comments

Every function, class, method and constructor declared at the top of a file, or in a class there, has a doc comment (`/** … */`): in the plugin, its tests, the scripts and the settings pages' scripts. A closure inside a function is read with the function around it and needs none. `npm run check:docs` checks this over the files Biome covers.

A doc comment says what the declaration does or why it exists, and follows the rules for comments above: it doesn't repeat what the code states.

- In TypeScript, the signature gives the types. `@param` and `@returns` appear only where a name doesn't explain itself, and never with a type.
- In JavaScript (the `.mjs` scripts and `ui/*.js`), every parameter has a `@param` and every function a `@returns`, with its type, which `checkJs` checks in the files `tsconfig.scripts.json` covers.
- A doc comment goes above a class's decorator, not between the decorator and the class: TypeScript only attaches it there.

### Spelling

Every new word must pass CSpell. Real terms go into the matching dictionary under `.cspell/`, in alphabetical order.

## Markdown

- Text is not hard-wrapped. Each paragraph, list item or callout is written on a single line, however long, and the editor wraps it on screen. A line break inside a paragraph changes nothing in the rendered document, but it has to be moved every time the text is edited, and it makes diffs show whole paragraphs as changed. Code blocks and tables are not affected.
- Headings are at most 80 characters, counting the `#` markers. No linter checks it (`MD013` can't limit headings without also limiting text), so `/lint` does.
- A document with several sections starts with its H1, followed by a table of contents that the [Markdown All in One][markdown-all-in-one] extension keeps up to date on save.
- Links are written in reference style, with the definitions collected at the bottom of the document.
- Unordered lists use `-`, indented by 2 spaces when nested.
- Proper names follow the capitalization enforced by `MD044` (for example GitHub and Python).
- Callouts use GitHub alerts (`> [!TIP]`, `> [!WARNING]`).

[better-comments]: https://github.com/aaron-bond/better-comments
[markdown-all-in-one]: https://github.com/yzhang-gh/vscode-markdown
