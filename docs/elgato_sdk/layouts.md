# Stream Deck + dial layouts

- [The canvas](#the-canvas)
- [Built-in layouts](#built-in-layouts)
- [Custom layouts](#custom-layouts)
- [Updating what a dial shows](#updating-what-a-dial-shows)
- [The dial in the app](#the-dial-in-the-app)
- [What fits on the Deck](#what-fits-on-the-deck)
- [Sources](#sources)

A dial on the Stream Deck + shows its state on its segment of the touch strip, through a layout: a set of slots (text, images, bars) that the plugin fills. This document describes the layouts the SDK offers and what was learnt about them on the Deck, so that a dial's display can be designed without trial and error.

## The canvas

Each dial gets a 200x100 px canvas on the touch strip. Every slot of a layout is placed on it with a `rect` of `[x, y, width, height]`.

## Built-in layouts

Stream Deck ships six layouts, chosen by name:

| Layout | Contents                                                               |
|--------|------------------------------------------------------------------------|
| `$X1`  | The title at the top, the icon centered beneath it.                    |
| `$A0`  | The title at the top, a full-width image beneath it.                   |
| `$A1`  | The title at the top, the icon on the left, a text value on the right. |
| `$B1`  | Like `$A1`, with a bar beneath the value.                              |
| `$B2`  | Like `$A1`, with a gradient bar and a marker beneath the value.        |
| `$C1`  | The title at the top, two rows of an icon and a bar.                   |

The dials use `$B1`, the layout of Stream Deck's own volume and microphone dials. Its slots are `title`, `icon`, `value` and `indicator` (the bar, filled by a number from 0 to 100). The `icon` slot shows the action's dial icon, `Encoder.Icon` in `manifest.json`: a PNG or SVG at 72x72 px and 144x144 px. The icon reads best as white line art on a transparent background, like Stream Deck's own: anything drawn behind the glyph shows up as a box on the strip.

## Custom layouts

A custom layout is a JSON file in the plugin folder, validated by the schema at `https://schemas.elgato.com/streamdeck/plugins/layout.json`. It lists items of four types (`text`, `pixmap`, `bar` and `gbar`), each with a `key` that the plugin fills and a `rect` on the canvas. A text item whose `key` is `title` follows the font settings the user picks in Stream Deck, and `setTitle` updates it.

A text's `font` takes a `size`, in whole pixels, and a `weight`, a whole number from 100 to 1000, and nothing else: there's no font family, so every text is drawn in the font Stream Deck picks. Which of those weights the Deck's font draws apart wasn't checked. The lamp screens offer the normal weight (400) and bold (700) ([#153]).

Items can't overlap unless their `zOrder` differs. Stream Deck refuses a layout with overlapping items and shows the dial's title and icon instead. The reason only appears in Stream Deck's own log, `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`, as a line starting with "Layout instantiation failed" that names the two items. With different `zOrder`s, overlapping items are accepted and all drawn, which the lamp layout relies on: since an item can't move, each of its cells has a text placed after an icon and one without, both spanning the row, and shows one of them ([#177]). A `pixmap`'s `value` can be set in the layout file, as a path from the plugin folder, so a fixed icon needs no `setFeedback`.

An icon and a text can't be joined into one string: the icon is a `pixmap`, in a slot of its own, fixed in place like every other. Nothing in the SDK measures a text, which Stream Deck draws in a proportional font, so where a text ends is unknown, and an icon can sit beside a text only against the text's aligned edge: before a left-aligned text, or after a right-aligned one. It can't follow a text's other end, or sit between a value and its unit, which would need the value's width. The value and its unit are both text, so their order is free, but an icon's is not ([#177]). Two ways around it were set aside:

- A text character in place of the icon, such as "☀", would make the icon part of the string. Stream Deck draws text in whatever fonts the machine has, though, and a character such as the thermometer, "🌡", is an emoji, which could show in color, differently on macOS and Windows, or not at all.
- The plugin could draw each cell as one image, its icon, value and unit together, in a single `pixmap`. Its text would have to be drawn as shapes, as the icon packs draw theirs, for the same reason, which would bring a font and a library that lays it out into the plugin.

So the lamp layout fixes each icon's place, on its cell's outer edge, with the cell's text aligned to its side: a left cell reads icon, value and unit from its left edge, and a right cell value, unit and icon up to its right edge. An icon on a cell's inner edge, at the middle of the row, with the text aligned against it, also worked on the Deck, but the slots on the cell's outer edge were left empty, so its value was drawn toward the middle of the row, out of line with the text of the rows above and below it, which starts at the cell's edge. It was tried as a choice for each cell, and dropped for a single fixed design ([#177]).

## Updating what a dial shows

- `Encoder.layout` in `manifest.json` sets a dial's layout, by name or by the path to a custom one. `setFeedbackLayout` replaces it at runtime.
- `setFeedback` fills the slots, keyed by their `key`. A slot takes either a plain value (a string or a number) or an object that changes its other properties too, such as a text's color, except its `key`, `rect` and `type`, which are fixed.
- The integration tests check that every key the plugin sends is one of its layout's: a custom layout's items, read from its file, and a built-in layout's slots, as listed in this document. A screen that uses another built-in layout needs its slots added to the tests.
- `enabled: false` in `setFeedback` hides a slot, a text or a pixmap, and `enabled: true` shows it again. A hidden slot leaves its place empty, and the slots around it stay where they are ([#177]).
- `showAlert` on a dial flashes its part of the touch strip red, where a key shows a yellow triangle (see [the notes on keys][keys]). It showed in full on a dial that went back to its main screen as it was shown, with another layout and new values.
- A bar's `bar_fill_c` takes a single color or a gradient of `{offset}:{color}` stops. The stops span the bar's filled part, not the whole bar, so a point at a given level sits at that level divided by the bar's `value`. Two stops 0.001 apart draw a sharp edge between two colors.

## The dial in the app

The schema says `Encoder.Icon` is also the app's round picture of the dial. On Stream Deck 7.6, the app shows the action's key image there instead (`States[0].Image`), for dials already placed and newly dragged ones alike, and after Stream Deck is quit and reopened ([#51]). This was seen on actions that have both a key and a dial. So the app pictures the Brightness and Temperature dials with their key image (`key`), drawn at the Litra icon pack's size, smaller than the full-size `glyph` that `Encoder.Icon` points at and the touch strip shows. The plugin doesn't need it, but `setImage` on a dial also changes that picture, as checked on the Deck, while the user hasn't picked a custom image for the dial.

## What fits on the Deck

Measured on a Stream Deck + XL's touch strip, while trying to show the lumens next to the brightness ([#8]) and while building the lamp screens ([#48]) and naming their lamps ([#20]):

- Text under about 16 px is hard to read, and a mid-grey on the strip's background doesn't contrast enough.
- At the size of `$B1`'s value, a value like `70%` already takes about half of the 108 px value area, so a second value doesn't fit on the same line.
- Three rows of 18 px text, two of them led by a 22 px icon, fit in the 200 × 100 px canvas and read well.
- At icon sizes of about 22 px, an outlined circle is hard to make out. A filled one reads better, which is why the brightness glyph, shown at that size on the lamp screens, uses a filled sun.
- Two texts share an 18 px row when both are short: a label like "Beam - 7K98" in 120 px, and "1 of 2" in 56 px.
- Two texts whose slots overlap are both drawn in full, one over the other, so two long values in one row, such as a label in each of a lamp screen's two cells, run into each other ([#177]).
- A left-aligned text is drawn about 7 px inside its slot, while a right-aligned one reaches its slot's edge. So a row whose slots start and end 12 px from the canvas's edges shows a left margin about twice its right one. The lamp layout's left cells start at the canvas's edge instead, which gives both sides about the same margin ([#177]).
- Dark text, such as `#202020`, contrasts with a bright background like orange, but in the font's normal weight its strokes are too thin to read at 18 px. Bold reads, though the font joins the "ff" of "Off" into one shape ([#153]).
- On the bar, a grey of `#999999` is barely readable against the bar's background, while `#c0c0c0` reads well ([#59]).

## Sources

Checked against `@elgato/streamdeck` 3.0.3 and the schemas in `@elgato/schemas`, both installed in `node_modules/`, and on the Deck:

- The canvas size, the built-in layouts and `Encoder.Icon`: the `Encoder` definition in `@elgato/schemas/streamdeck/plugins/manifest.json`.
- The item types and the `title` key: `@elgato/streamdeck/dist/api/layout.d.ts` and `@elgato/schemas/streamdeck/plugins/layout.json`.
- `setFeedback`, `setFeedbackLayout`, `setImage` and `showAlert`: `@elgato/streamdeck/dist/plugin/actions/dial.d.ts`.
- A dial's alert: seen on the Deck, turning a dial on the lamp screen of a lamp that had been unplugged ([#20]).
- Overlapping items with different `zOrder`s, `enabled` in `setFeedback`, overlapping texts, the margin a left-aligned text keeps in its slot, and where an icon can sit beside a text: seen on the Deck, choosing what each cell of the lamp screens shows, and how ([#177]).

[#8]: https://github.com/daczarne/streamdeck-litra/issues/8
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#59]: https://github.com/daczarne/streamdeck-litra/issues/59
[#153]: https://github.com/daczarne/streamdeck-litra/issues/153
[#177]: https://github.com/daczarne/streamdeck-litra/issues/177
[keys]: keys.md
