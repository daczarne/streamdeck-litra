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

Items can't overlap unless their `zOrder` differs. Stream Deck refuses a layout with overlapping items and shows the dial's title and icon instead. The reason only appears in Stream Deck's own log, `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`, as a line starting with "Layout instantiation failed" that names the two items. A `pixmap`'s `value` can be set in the layout file, as a path from the plugin folder, so a fixed icon needs no `setFeedback`.

## Updating what a dial shows

- `Encoder.layout` in `manifest.json` sets a dial's layout, by name or by the path to a custom one. `setFeedbackLayout` replaces it at runtime.
- `setFeedback` fills the slots, keyed by their `key`. A slot takes either a plain value (a string or a number) or an object that changes its other properties too, such as a text's color, except its `key`, `rect` and `type`, which are fixed.
- A bar's `bar_fill_c` takes a single color or a gradient of `{offset}:{color}` stops. The stops span the bar's filled part, not the whole bar, so a point at a given level sits at that level divided by the bar's `value`. Two stops 0.001 apart draw a sharp edge between two colors.

## The dial in the app

The schema says `Encoder.Icon` is also the app's round picture of the dial. On Stream Deck 7.6, the app shows the action's key image there instead (`States[0].Image`), for dials already placed and newly dragged ones alike, and after Stream Deck is quit and reopened ([#51]). This was seen on actions that have both a key and a dial. So the Brightness and Temperature actions use one image for both, named for neither: `States[0].Image` and `Encoder.Icon` both point at the action's `glyph`. `setImage` on a dial also changes that picture, as checked on the Deck, but only while the user hasn't picked a custom image for the dial.

## What fits on the Deck

Measured on the Stream Deck + XL's touch strip, while trying to show the lumens next to the brightness ([#8]) and while building the lamp screens ([#48]):

- Text under about 16 px is hard to read, and a mid-grey on the strip's background doesn't contrast enough.
- At the size of `$B1`'s value, a value like `70%` already takes about half of the 108 px value area, so a second value doesn't fit on the same line.
- Three rows of 18 px text, two of them led by a 22 px icon, fit in the 200 × 100 px canvas and read well.
- At icon sizes of about 22 px, an outlined circle is hard to make out. A filled one reads better, which is why the brightness glyph, shown at that size on the lamp screens, uses a filled sun.
- On the bar, a grey of `#999999` is barely readable against the bar's background, while `#c0c0c0` reads well ([#59]).

## Sources

Checked against `@elgato/streamdeck` 3.0.1 and the schemas in `@elgato/schemas`, both installed in `node_modules/`, and on the Deck:

- The canvas size, the built-in layouts and `Encoder.Icon`: the `Encoder` definition in `@elgato/schemas/streamdeck/plugins/manifest.json`.
- The item types and the `title` key: `@elgato/streamdeck/dist/api/layout.d.ts` and `@elgato/schemas/streamdeck/plugins/layout.json`.
- `setFeedback`, `setFeedbackLayout` and `setImage`: `@elgato/streamdeck/dist/plugin/actions/dial.d.ts`.

[#8]: https://github.com/daczarne/streamdeck-litra/issues/8
[#48]: https://github.com/daczarne/streamdeck-litra/issues/48
[#51]: https://github.com/daczarne/streamdeck-litra/issues/51
[#59]: https://github.com/daczarne/streamdeck-litra/issues/59
