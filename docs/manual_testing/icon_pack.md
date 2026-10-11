# Testing the icon pack

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

`npm run check:icons` checks that the pack is complete: every icon listed in `icons.json`, present and sized as Elgato asks, and the manifest's required members set. The checks below cover what it takes for granted: that Stream Deck loads the pack from the repository, and that its Icon Library shows and finds the icons. How Stream Deck loads and shows a pack is described in [`icon_packs.md`][icon-packs].

## When to run these checks

- After a change to the pack: its icons, `icons.json` or `manifest.json`.
- After a Stream Deck update.

## Setup

Regenerate the icons and link the pack into Stream Deck:

```shell
npm run icons
npm run link:icons
```

The first time the pack is linked, quit and reopen Stream Deck: it only finds a new pack when it starts. After that, a change shows the next time the Icon Library is opened. Open the Icon Library from any key's image menu (the down chevron, then **Open Stream Deck Icon Library**).

## Checks

1. **The pack is listed.** The Icon Library lists "Litra" with the lamp as its icon, and the number of icons in `icons.json`.
2. **Every icon shows.** Expand the pack: its icons show in the order of `icons.json`, each as drawn by `scripts/generate-icons.mjs`. Hovering over an icon shows its name and "Litra".
3. **Search finds the icons.** Searching for an icon's name finds it, and so does searching for one of its tags. Searching for "litra" finds every icon in the pack.
4. **An icon works on a key.** Assign one of the pack's icons to a key: the key shows it on the Deck, with the same colors as in the library.

[icon-packs]: ../elgato_sdk/icon_packs.md
