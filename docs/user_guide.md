# User guide

- [The lamps the plugin controls](#the-lamps-the-plugin-controls)
- [Keys](#keys)
  - [Power](#power)
  - [Brightness and Temperature](#brightness-and-temperature)
  - [Scene](#scene)
  - [Brightness and Temperature Up and Down](#brightness-and-temperature-up-and-down)
  - [Picking a key's lamps](#picking-a-keys-lamps)
- [Dials](#dials)
  - [The main screen](#the-main-screen)
  - [Lamp screens](#lamp-screens)
  - [What a lamp screen shows](#what-a-lamp-screen-shows)
- [Steps](#steps)
  - [Where a step stops](#where-a-step-stops)
  - [Lamps together or apart](#lamps-together-or-apart)
- [The plugin settings](#the-plugin-settings)
  - [Lamps](#lamps)
  - [Keys](#keys-1)
  - [Dials](#dials-1)
- [When something doesn't work](#when-something-doesnt-work)

> [!WARNING]
> On the `refactoring` branch, this guide describes the plugin as it will be once [#198] is done, not the code as it is. Each step of the refactor changes it where the design doesn't work out. This note comes out before the branch is merged into `main`.

This guide describes how to use the plugin once it's installed (see [the README][installing]): what each action does on a key or a dial, which lamps it controls, and the settings the actions share.

## The lamps the plugin controls

When the plugin starts knowing no lamps, as it does the first time, it finds the lamps connected, and controls those alone: a lamp plugged in later is left alone until **Find lamps**, in [the plugin settings](#lamps), finds it. Unplugging a lamp doesn't make the plugin forget it: only its trash can there does.

Each key acts on the lamps picked on its settings page: every lamp the plugin knows, unless others are picked (see [Picking a key's lamps](#picking-a-keys-lamps)). A dial's main screen acts on every lamp, and its lamp screens on one lamp at a time (see [Lamp screens](#lamp-screens)). Wherever the plugin lists the lamps, it lists them in the order of the plugin settings' table.

Every Power key, Up and Down key, dial and lamp screen follows changes made by any key or dial. When the plugin starts, it reads every lamp it knows that's connected, and from then on, the keys and dials show what the plugin last set each lamp to, as the lamp reported it.

The plugin is made for controlling the lamps through it, and through it alone. A change made another way, with a lamp's own buttons, Logitech's software or a CLI, isn't followed: the Deck goes on showing what the plugin last set, and the lamp comes back in step at the next change made through the plugin. For example, a lamp the plugin set to 10%, and brought to 20% with its own button, still shows 10%. Turning a dial one step up from there, by 10%, sets the lamp to 20%, which it's already at. A lamp unplugged and plugged in again is read again the next time the plugin reaches it.

A brightness change, from a key or a dial, turns a lamp that's off on first, while a temperature change leaves it off, at the temperature it'll turn on at.

A lamp on a power supply too weak for it, such as a Stream Deck + XL's hub, stops below the brightness it's sent (see [Supported hardware][hardware]). The keys and dials show the brightness it reached, not the one asked for, and the plugin sends it no more than that until it's plugged in again.

## Keys

### Power

A Power key turns its lamps on, turns them off, or toggles them. In its toggle mode, it turns its lamps off when every one of them is on, and on otherwise. It shows on only when every one of its lamps that's connected is on, and off when none is connected.

### Brightness and Temperature

Brightness and Temperature keys set their lamps to the preset in their settings. They show their preset value, as a bare number at the bottom of the key, set by the plugin. A title typed in the key's settings replaces it, and the **Show Title** box under the **T** menu hides it.

### Scene

A Scene key sets its lamps in one press, so one key goes to a setup and another comes back: it turns them on, then sets their temperature and brightness, or turns them off, as its Power switch says. A group's power, temperature and brightness sit on one row.

**Add a group**, on its settings page, adds a group of lamps with its own power, brightness and temperature, such as a key light brighter than a fill light, and **Remove group** takes it away. A lamp is in one group at most: the other groups show it greyed out, with the group that holds it, and it moves once it's unchecked there. The first group picks its lamps as every key does, lamps added later included (see [Picking a key's lamps](#picking-a-keys-lamps)), and a lamp no group holds is left as it is.

A Scene key shows only its image: a title typed in its settings shows at the bottom.

### Brightness and Temperature Up and Down

Brightness and Temperature Up and Down keys step their lamps by the step in their settings, as one tick of a dial, for decks without dials (see [Steps](#steps)). They show what their lamps are at, as the dials do: the brightest lamp's %, or the first lamp's temperature in Kelvin, the first in the plugin settings' list of lamps, as on the lamp screens, and a dash when none of their lamps is connected. A title typed in the key's settings replaces it.

### Picking a key's lamps

A key's settings page lists the lamps the plugin knows by their names, or else as their model and the last 4 characters of their serial number, such as "Beam - 7K98". The key acts on the lamps checked there, and All checks every lamp listed. A lamp that isn't plugged in stays listed, so it can be checked or unchecked, and a lamp the plugin forgets leaves the list, and comes back as the key left it once Find lamps finds it again.

By default, a key also takes in lamps added later: it acts on every lamp but the ones left unchecked, so a lamp Find lamps adds shows checked. With "Add new lamps automatically, on this key" unchecked, under its lamps, a key acts on the lamps checked alone, and a lamp Find lamps adds shows unchecked. "Add new lamps automatically, on every key", under "Keys" in [the plugin settings](#keys-1), makes that choice for every key at once, and shows a bar when the keys differ.

## Dials

### The main screen

Dials look like Stream Deck's own volume dials: the value, with a bar under it. The keys, and the dials' pictures in the Stream Deck app, show the same line icon as the strip, smaller, at the size of the Icon Library's Litra icons. The temperature bar runs from the lamp's warmest setting (empty) to its coolest (full). The brightness bar is white up to the dimmest lamp's level, and a lighter grey from there to the brightest lamp's, the part only some lamps reach. Their title says what they control ("Brightness", "Temperature"), and can be replaced or hidden like a key's.

Rotating adjusts every lamp (see [Steps](#steps)), and pressing toggles every lamp, as a Power key in its toggle mode does (see [Power](#power)). A Brightness dial shows the brightest lamp's %, and a Temperature dial the first lamp's temperature, the first in the plugin settings' list of lamps, and a dash when no lamp is connected. Holding the strip does nothing on the main screen.

### Lamp screens

Tapping a dial's part of the strip shows one screen per lamp. Each tap shows the next lamp, in the order of the plugin settings' list, and the dial's own screen after the last. The dial stays on a lamp screen until it's tapped past the last lamp, a press, turn or tap finds its lamp unplugged, or the Deck shows another page. Tapped after its lamp is unplugged, it shows the next lamp connected.

On a lamp screen, the dial controls that lamp alone: turning it changes the lamp's brightness or temperature, and pressing it turns the lamp on or off. Holding the strip blinks the lamp once, to show which one it is. A turn on the dial's own screen sets every lamp to the same value again, unless the lamps keep their difference (see [Lamps together or apart](#lamps-together-or-apart)).

With "Blink each lamp as it's shown, on this dial" checked on a Brightness or Temperature dial's settings page, each tap that shows a lamp blinks it too, and the next tap waits for the blink to end. The plugin settings turn it on or off for every dial at once, and their checkbox shows a bar when the dials differ. It's off by default, since every lamp then blinks in turn, which shows on camera.

### What a lamp screen shows

By default, a lamp screen shows the lamp's label, the model and the last 4 characters of its serial number, as a key's settings page lists a lamp without a name, with its place among the lamps ("1 of 2"), then its temperature and whether it's on, and its brightness in % and lumens. "OFF" shows in dark grey.

Its six cells, three rows of two, can each show any of these, or nothing, chosen under "Layout" in the plugin settings, the same on every dial. Two long values chosen for one row can run into each other. Each cell's **Configure** button shows how it shows its item, in place of the plugin settings, and **Reset** there brings back the defaults:

- The identification is made of two parts, each the model, the ID, the name given in the plugin settings, or empty, joined by " - " when both have text. A lamp with no name shows its model and ID for its name, and a part with no text is left out. Trimmed, it keeps to about half a row, ending in "…".
- The counter shows the lamp's place, alone, among every lamp, or among the lamps of its model, as "1 of 2", "1/2", "1-2" or "1 2".
- The temperature and the brightness, in % or in lumens, can each show their unit and their icon. A left cell reads icon, value and unit from its left edge, and a right cell value, unit and icon up to its right edge. The lumens show the brightness's sun, and no icon by default.
- The power shows a label for each state, "On", "ON", "●" or "I" when the lamp is on, and "Off", "OFF", "○" or "O" when it's off, in a text style, or in a color and a weight of its own.

Under "Text styles", the plugin settings set the lamp screens' four styles: Primary, for every text by default, Secondary, toned down, for "OFF" by default, Accent, to draw the eye, and Alert, for something wrong. Each cell's **Font style**, in its editor, picks the one it shows in, and each of the power's states picks its own. Each takes a color, a weight, Normal or Bold, and a size from 16 to 22 px, and its **Reset** button brings back its defaults. The temperature's and the brightness's icons take their cell's color.

## Steps

### Where a step stops

A dial turns, and an Up or Down key steps, by the step in its settings, and stops on the multiples of that step counted from the bottom of the range (0% or 2700 K), the same values going up as going down. From a value between two of them, such as a lamp's cap or a key's preset, the first step goes to the next one in the direction of the turn. When the step doesn't divide the range, the last step to 100% or 6500 K is shorter.

### Lamps together or apart

By default, a turn on a dial's own screen, and a press of an Up or Down key, set every lamp to the same value, stepped from the one the dial or key shows.

With "Each lamp steps from its own brightness" checked under "Lamps" in the plugin settings, each lamp steps from its own brightness instead, so lamps set apart on their lamp screens stay apart. A lamp that reaches 0%, 100% or its cap stays there, while the others keep going, and the plugin remembers how far the lamp would have gone, so it comes back with them and the lamps keep their difference. Once every lamp is at its end, turning further does nothing. Setting a lamp any other way through the plugin, or restarting the plugin, forgets how far it would have gone. Lamps that keep their difference each step along the multiples of the step, so their difference can change by up to a step on the first turn.

Every Brightness dial and key shares that setting, and the Temperature dials and keys share one of their own, so the lamps can keep their brightness apart while their temperature stays matched.

## The plugin settings

Every settings page, on a key or a dial, starts with a **Plugin settings** button, which shows the plugin's own settings in place of the action's, and **Back** returns to them. They come in sections, by what the settings reach. Every dial and key shares these settings.

### Lamps

"Lamps" lists the lamps the plugin knows, in the order of the last 4 characters of their serial numbers, each by those 4 characters and its model, with a field for its name, up to 24 characters, an Identify button that blinks it, and a trash can that forgets it.

**Find lamps** adds the lamps connected that the plugin doesn't know yet (see [The lamps the plugin controls](#the-lamps-the-plugin-controls)). The table greys out the lamps the plugin didn't find the last time it looked, with "Not found" in place of Identify: at the last Find lamps, or the last press, turn or tap that reached the lamps. A lamp's trash can takes its name too, until Find lamps finds it again. A name is the lamp's, not a key's: every key shows it. Emptying the field takes it away.

Under the lamps come how each lamp steps, for its brightness and its temperature (see [Lamps together or apart](#lamps-together-or-apart)), and "Blink length", how long a blink lasts, for Identify and on the lamp screens, from 300 ms to 1.5 s. Its default, 400 ms, suits dim lamps: a lamp fades as it goes off, so a bright lamp among others that stay on needs a longer blink to show.

### Keys

"Keys" holds whether every key takes in lamps added later (see [Picking a key's lamps](#picking-a-keys-lamps)).

### Dials

"Dials" holds the lamp screens' blink for every dial (see [Lamp screens](#lamp-screens)), what they show and their text styles (see [What a lamp screen shows](#what-a-lamp-screen-shows)).

## When something doesn't work

A key or a dial shows Stream Deck's alert indicator when it can't do all it was asked:

- None of its lamps is connected, or none of the lamps connected is one the plugin knows (see [The lamps the plugin controls](#the-lamps-the-plugin-controls)).
- Its settings page checks no lamp, or leaves out every lamp connected (see [Picking a key's lamps](#picking-a-keys-lamps)).
- A lamp fails. The others don't wait for it: they're still set.
- A Beam LX doesn't give its serial number, on a key that acts on every lamp, or on every lamp but some, since it could be one of them.
- On a lamp screen, a tap with no lamp connected, a hold whose lamp can't be blinked, or a turn or a push once its lamp is unplugged.

A Power key shows the alert once it has redrawn its state, which would cover the alert otherwise (see [Stream Deck keys][keys]). With none of their lamps connected, a Power key shows off, and the dials and the Up and Down keys show a dash.

When a lamp takes a change but doesn't answer what it did, such as on a USB error, the plugin asks again, and when the lamp still doesn't answer, it shows what was asked for. The lamp may then be elsewhere until the next change made through the plugin.

If something else doesn't work, [an issue][issues] with the plugin's log helps. The logs are in the plugin's folder, newest in `litra.log`:

- On macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.daczarne.litra.sdPlugin/logs/`
- On Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\com.daczarne.litra.sdPlugin\logs\`

They hold your lamps' serial numbers, so remove those before posting.

[#198]: https://github.com/daczarne/streamdeck-litra/issues/198
[hardware]: ../README.md#supported-hardware
[installing]: ../README.md#installing
[issues]: https://github.com/daczarne/streamdeck-litra/issues
[keys]: elgato_sdk/keys.md
