# Stream Deck icon packs

- [The format](#the-format)
- [Installing while developing](#installing-while-developing)
- [What the Icon Library shows](#what-the-icon-library-shows)
- [Keys keep a copy of their icon](#keys-keep-a-copy-of-their-icon)
- [Sources](#sources)

An icon pack adds icons to Stream Deck's Icon Library, where any key or dial can pick them. It is a package of its own, separate from plugins: the Stream Deck CLI and SDK know nothing about it. This document describes the format and how Stream Deck loads a pack, as found in Elgato's documentation, in installed packs and on the Deck ([#72]).

## The format

A pack is a folder named by its ID in reverse-DNS form, with a `.sdIconPack` extension, such as `com.daczarne.litra.sdIconPack`. The Icon Library shows that ID next to the pack's name.

- **`manifest.json`.** `Name`, `Author`, `Version` and `Icon` (the path to the pack's own icon, best at 56 × 56 px) are required. `Description`, `URL` and `License` (the path to a `.txt` file) are optional.
- **`icons.json`.** One entry per icon, in the order the library shows them: `path` (relative to `icons/`), `name` (the display name) and `tags` (a list of strings). Elgato marks all three as required, though a pack whose icons have no tags still loads.
- **`icons/`.** The icons, at 144 × 144 px, as SVG, PNG or JPEG, with file names of at most 80 characters. Stream Deck scales them itself, so unlike a plugin's images they come in one size. Animated icons are GIF or WEBP, each with a PNG of the same name next to it, which `icons.json` doesn't list.

Elgato builds packs with Icon Pack Man, a web app that exports a `.streamDeckIconPack` file, installed with a double-click. The file's contents aren't documented. It is only needed to distribute a pack: Stream Deck also loads an unpacked folder.

## Installing while developing

Stream Deck loads every folder in `~/Library/Application Support/com.elgato.StreamDeck/IconPacks/`, including a symlink to a folder elsewhere, so a pack can run from the repository, as the plugin does.

- **Adding a pack** takes effect only once Stream Deck is quit and reopened.
- **Changing a pack** it already knows (renaming, adding or removing an icon, or changing the pack's icon) shows the next time the Icon Library is opened. A library that is already open doesn't update.
- **Removing a pack** takes effect at once.

## What the Icon Library shows

- **The pack.** Its icon, its `Name` and how many icons it has. The pack list capitalizes the name ("Litra (Test)" for "Litra (test)"), while search results show it as written. The `Author` doesn't show anywhere.
- **An icon.** Hovering over it shows its `name` and the pack's name.
- **Search.** It matches an icon's `name` and its `tags`, ignoring case, and groups the results by pack, next to matching icons from every other pack.

## Keys keep a copy of their icon

When an icon is assigned to a key, Stream Deck copies it into the profile: the key's entry in the profile's `manifest.json` points at an image in the profile's own `Images/` folder, not at the pack. So redrawing an icon in a pack doesn't change the keys that already use it, until it's assigned to them again. A key keeps its icon even after the pack is removed.

## Sources

Checked on Stream Deck 7.6, on macOS, against:

- Elgato's [API glossary for icon packs][api], [icon pack overview][overview] and [icon guidelines][guidelines].
- The packs installed in `IconPacks/`, including Elgato's Legion pack.
- A test pack linked into `IconPacks/` on the Deck.

[#72]: https://github.com/daczarne/streamdeck-litra/issues/72
[api]: https://docs.elgato.com/stream-deck/icons/api
[guidelines]: https://docs.elgato.com/guidelines/stream-deck/icons
[overview]: https://docs.elgato.com/makers/stream-deck/icon-packs/overview
