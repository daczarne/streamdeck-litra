# Releases

- [When to release](#when-to-release)
- [The version](#the-version)
- [Making a release](#making-a-release)
  - [1. A branch that raises the version](#1-a-branch-that-raises-the-version)
  - [2. The merge drafts the release](#2-the-merge-drafts-the-release)
  - [3. Publishing](#3-publishing)

This document describes how a release of the plugin is made, from the branch that raises its version to the published release, and why each step is there. How the package is built, and what it holds, is in the Packaging section of [the README][packaging].

## When to release

There's no schedule. A release is made when what has been merged since the last one is worth installing, and it's made by a pull request that raises the version: nothing else starts one. The plugin isn't on Elgato's Marketplace, so a release is a file on GitHub, which users download and open. Only the latest release gets fixes (see [`SECURITY.md`][security]): a fix ships in a new release, never in an old one.

## The version

The version is the `Version` in `com.daczarne.litra.sdPlugin/manifest.json`. Elgato's format has four numbers, `{major}.{minor}.{patch}.{build}`, and the last one stays 0. The release's tag, and the version users see, is the first three, as `v{major}.{minor}.{patch}`.

Releases follow [semantic versioning][semver], where a breaking change is one that breaks keys already set up, such as a renamed action or a setting whose meaning changes. Before 1.0, a release that adds or changes what the plugin does raises the minor, and one that only fixes something raises the patch. A breaking change needs no migration until then (see "Before 1.0, settings change without a migration" in [the contributing guide][contributing]).

If the plugin is ever on Elgato's Marketplace, Stream Deck will update it on its own by default, so a new major version won't hold its users back: it only tells them that something may have broken.

## Making a release

### 1. A branch that raises the version

The version is written in three files, which the branch raises together:

- `Version` in `manifest.json`, the version itself, which CI reads.
- The placeholder of the plugin version field, in `.github/ISSUE_TEMPLATE/bug_report.yaml` and `lamp_report.yaml`, so a reporter sees the latest release as an example of what to fill in.

The branch also checks `.github/release-notes.md`, which is the same for every release, against what the release changes:

- What the plugin needs, Stream Deck 7.1 or later on macOS 12 or later or Windows 10 or later, matches the minimum versions of `Software` and `OS` in `manifest.json`.
- What it says is checked, and what isn't, such as the lamps and the systems, is still true.

The branch can be the one that brings the release's last change, or one of its own, which only raises the version.

### 2. The merge drafts the release

Once the branch is merged, CI's last job runs on the push to `main`, after every check has passed. When the manifest's version has no release yet, drafts included, it:

1. Packs the plugin with `npm run pack`, as the Packaging section of [the README][packaging] describes.
2. Records the package's provenance in an attestation, which ties it to the commit and the workflow that built it.
3. Drafts a release tagged `v{major}.{minor}.{patch}`, which holds the package and the notes from `.github/release-notes.md`, with the version and the package's SHA-256 filled in, followed by the pull requests merged since the last release, which GitHub lists.

A merge that doesn't raise the version finds its release already made, and drafts nothing.

### 3. Publishing

Publishing the draft is manual, once its notes are read: the pull requests GitHub lists are the release's changes, and their titles should read as such. Publishing creates the tag, on the commit the draft points to.

Releases aren't checked as an installed plugin: development runs linked from the repository, so an installed plugin is only tried by its users, who report what doesn't work ([#21]).

[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[contributing]: contributing.md
[packaging]: ../README.md#packaging
[security]: ../SECURITY.md
[semver]: https://semver.org
