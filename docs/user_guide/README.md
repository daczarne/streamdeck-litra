# User guide

- [The lamps the plugin controls](#the-lamps-the-plugin-controls)
- [Keys](#keys)
  - [Power](#power)
  - [Scene](#scene)
  - [Set Brightness and Set Temperature](#set-brightness-and-set-temperature)
  - [Brightness and Temperature Up and Down](#brightness-and-temperature-up-and-down)
  - [Picking a key's lamps](#picking-a-keys-lamps)
- [Dials](#dials)
  - [The main screen](#the-main-screen)
  - [Lamp screens](#lamp-screens)
  - [What a lamp screen shows](#what-a-lamp-screen-shows)
  - [Text styles](#text-styles)
- [Steps](#steps)
  - [Where a step stops](#where-a-step-stops)
  - [Lamps together or apart](#lamps-together-or-apart)
- [The plugin settings](#the-plugin-settings)
  - [Lamps](#lamps)
  - [Keys](#keys-1)
  - [Dials](#dials-1)
- [When something doesn't work](#when-something-doesnt-work)

This guide describes how to use the plugin once it's installed (see [the README][installing]): what each action does on a key or a dial, which lamps it controls, and the settings the actions share.

## The lamps the plugin controls

When the plugin starts knowing no lamps, as it does the first time, it finds the lamps connected, and controls those alone: a lamp plugged in later is left alone until **Find lamps**, in [the plugin settings](#lamps), finds it. Unplugging a lamp doesn't make the plugin forget it: only its trash can there does.

Each key acts on the lamps picked on its settings page: every lamp the plugin knows, unless others are picked (see [Picking a key's lamps](#picking-a-keys-lamps)). A dial's main screen acts on every lamp connected, and its lamp screens on one lamp at a time (see [Lamp screens](#lamp-screens)). Wherever the plugin lists the lamps, it lists them in the order of the plugin settings' table.

Every Power key, Up and Down key, dial and lamp screen follows changes made by any key or dial. When the plugin starts, it reads every lamp it knows that's connected, and so does Find lamps with the lamps it adds, and from then on, the keys and dials show what the plugin last set each lamp to, as the lamp reported it.

The plugin is made for controlling the lamps through it, and through it alone. A change made another way, with a lamp's own buttons, Logitech's software or a CLI, isn't followed: the Deck goes on showing what the plugin last set, and the lamp comes back in step at the next change made through the plugin. For example, a lamp the plugin set to 10%, and brought to 20% with its own button, still shows 10%. Turning a dial one step up from there, by 10%, sets it to 20%, one step from the 10% the plugin holds. A lamp unplugged and plugged in again is read again the next time the plugin reaches it. **Re-sync lamps**, in [the plugin settings](#lamps), brings them back in step at once, whichever way is wanted.

A brightness or temperature change, from a key or a dial, changes only that: a lamp that's off stays off, at the brightness and temperature it'll turn on at, and pressing a dial turns its lamps on or off. Each kind of key, and each dial's main screen and lamp screens, can turn the lamps on as it changes them instead, from [the plugin settings](#keys-1), and a key or a dial can choose otherwise for itself alone, on its own settings page.

A lamp on a power supply too weak for it, such as a Stream Deck + XL's hub, stops below the brightness it's sent (see [Supported hardware][hardware]). It stops there whether it's on or off. The keys and dials show the brightness it reached, not the one asked for, and the plugin sends it no more than that until it's plugged in again.

## Keys

### Power

A Power key turns its lamps on, turns them off, or toggles them. In its toggle mode, it turns its lamps off when every one of them is on, and on otherwise. It shows on only when every one of its lamps that's connected is on, and off when none is connected.

### Scene

A Scene key sets its lamps in one press, so one key goes to a setup and another comes back: it turns them on, then sets their temperature and brightness, or turns them off, as its Power switch says. A group's power, temperature and brightness sit on one row. A group that turns its lamps off leaves their temperature and brightness as they are, so while its Power is off, its Temperature and Brightness are greyed out and show a dash, with a note under them that they aren't applied. They keep their values, which show again once Power is back on.

**Add a new group**, on its settings page, adds a group of lamps with its own power, brightness and temperature, such as a key light brighter than a fill light, under the next number after Group 1, the key's own settings, and **Remove group** takes it away. A lamp is in one group at most: the other groups show it greyed out, with the group that holds it, and it moves once it's unchecked there. The first group picks its lamps as every key does, lamps added later included (see [Picking a key's lamps](#picking-a-keys-lamps)), and a lamp no group holds is left as it is. Its All means every lamp the plugin knows, so it's unchecked and greyed out while another group holds a lamp.

A Scene key shows only its image: a title typed in its settings shows at the bottom.

### Set Brightness and Set Temperature

Set Brightness and Set Temperature keys set their lamps to the preset in their settings. They show their preset value with its unit, such as "70%" or "4000 K", at the bottom of the key, set by the plugin, as the Up and Down keys and the dials show theirs. With **Title value** at Current, in the key's settings, the key shows what its lamps are at instead, as an Up or Down key does, and follows every change to them. A title typed in the key's settings replaces either, and the **Show Title** box under the **T** menu hides it.

### Brightness and Temperature Up and Down

Brightness and Temperature Up and Down keys step their lamps by the step in their settings, as one tick of a dial, for decks without dials (see [Steps](#steps)). They show what their lamps are at, as the dials do: the brightest lamp's %, or the highest temperature in Kelvin, and a dash when none of their lamps is connected. **Title value**, in the key's settings, chooses what the key shows instead: Current, what its lamps are at, by default, Next, what a press takes them to, which follows the grid of its step and stops at an end of their range, or Step, the key's step, such as "+10%" or "−300 K". Next stops at a lamp's cap only once the plugin has learned it, the first time the lamp falls short of what it was sent: until then, it shows the step's value, and the key shows the cap once it's pressed. A title typed in the key's settings replaces any of them.

### Picking a key's lamps

A key's settings page lists the lamps the plugin knows by their names, or else as their model and 4 characters that tell them apart, the end of the id the plugin gives each lamp, such as "Beam - c870". The key acts on the lamps checked there, and All checks every lamp listed. A lamp that isn't plugged in stays listed, so it can be checked or unchecked, and a lamp the plugin forgets leaves the list, and comes back as the key left it once Find lamps finds it again.

By default, a key also takes in lamps added later: it acts on every lamp but the ones left unchecked, so a lamp Find lamps adds shows checked. With "Add new lamps automatically, on this key" unchecked, under its lamps, a key acts on the lamps checked alone, and a lamp Find lamps adds shows unchecked. "Add new lamps automatically, on every key", under "Keys" in [the plugin settings](#keys-1), makes that choice for every key at once, and shows a bar when the keys differ.

## Dials

The dials have actions of their own, Brightness and Temperature, apart from the Set Brightness and Set Temperature keys, since a dial steps its lamps and shows each one, while a key sets them to its preset.

### The main screen

Dials look like Stream Deck's own volume dials: the value, with a bar under it. The keys, and the dials' pictures in the Stream Deck app, show the same line icon as the strip, smaller, at the size of the Icon Library's Litra icons. The brightness bar is white up to the dimmest lamp's level, and a lighter grey from there to the brightest lamp's, the part only some lamps reach. The temperature bar runs from the lamps' warmest setting (empty) to their coolest (full), and is white up to the warmest lamp's temperature, and a lighter grey from there to the coolest lamp's. Their title is their action's name by default ("Brightness", "Temperature"), and is set for every dial of an action under "Main screen" in the plugin settings, where an empty title hides it. The **Title** field on a dial's own settings page gives that dial a title of its own: while it's empty, it shows the plugin settings' title in grey, which the dial shows, and the **×** at its end empties it. Stream Deck's own title menu doesn't show on a dial's settings page, since the plugin draws the title.

The title, the icon, the value and the bar each take their color from one of the [text styles](#text-styles), Primary by default, chosen under "Layout", in the plugin settings' "Main screen", the same on every dial. Each one's **Reset** button brings back Primary. Only the color is chosen: the icon keeps its shape and size, the title and the value their font and size, and each keeps its place on the strip. Where only some lamps reach, the bar is a darker shade of a light color, as white turns grey, and a lighter shade of a dark one, as black turns dark grey, so the color chosen is always where every lamp reaches.

Rotating adjusts every lamp (see [Steps](#steps)), and pressing toggles every lamp, as a Power key in its toggle mode does (see [Power](#power)). A Brightness dial shows the brightest lamp's %, and a Temperature dial the highest temperature, and a dash when no lamp is connected. Holding the strip does nothing on the main screen.

### Lamp screens

Tapping a dial's part of the strip shows one screen per lamp. Each tap shows the next lamp, in the order of the plugin settings' list, and the dial's own screen after the last. The dial stays on a lamp screen until it's tapped past the last lamp, a press, turn, hold or tap finds its lamp unplugged, or the Deck shows another page. Tapped after its lamp is unplugged, it shows the next lamp connected.

A dial starts on its own screen whenever it appears: as the plugin starts, a profile or a page of the Deck is shown, or the dial is placed. **Start on**, on its settings page, starts it on a lamp's screen instead, listing every lamp the plugin knows by its name, or else its model and the end of its id. Until its strip is tapped, the dial shows that lamp while it's connected, and its own screen otherwise, so it goes to the lamp once the plugin finds it, such as just after it starts, and back to its own screen if the lamp is unplugged. It looks for the lamps each time it appears, as a tap does, so a lamp unplugged or plugged back in while its page wasn't shown shows as soon as the page is. A lamp unplugged while the page is shown shows once anything is pressed, turned or tapped, since the plugin only looks for the lamps then. The lamp shown this way doesn't blink, even with the blink checked, so swiping to a page of lamp dials blinks nothing. The first tap goes on from there as usual, and the taps choose the screen until the dial appears again. A lamp the plugin forgets leaves the dial on its own screen. Beside Start on, a color shows that lamp in Gold, Orange, Green, Blue, Violet or Magenta in place of the Primary [text style](#text-styles), so a page with a dial for each lamp tells them apart at a glance. Text in another style keeps its own color, and the lamp keeps the text styles on any other dial, and on this one for every other lamp the taps get to. **Default** leaves the text styles as they are, and the color is greyed out while the dial starts on its own screen.

On a lamp screen, the dial controls that lamp alone: turning it changes the lamp's brightness or temperature, and pressing it turns the lamp on or off. Holding the strip blinks the lamp once, to show which one it is. A turn on the dial's own screen sets every lamp to the same value again, unless the lamps keep their difference (see [Lamps together or apart](#lamps-together-or-apart)).

With "Blink each lamp as it's shown, on this dial" checked on a Brightness or Temperature dial's settings page, each tap that shows a lamp blinks it too, and the next tap waits for the blink to end. The plugin settings turn it on or off for every dial at once, and their checkbox shows a bar when the dials differ. It's off by default, since every lamp then blinks in turn, which shows on camera.

### What a lamp screen shows

By default, a lamp screen shows the lamp's label, its model and the end of its id, as a key's settings page lists a lamp without a name, with its place among the lamps ("1 of 2"), then its temperature and whether it's on, and its brightness in % and lumens. "OFF" shows in dark grey.

Its six cells, three rows of two, can each show any of these, or nothing, chosen under "Layout" in the plugin settings, the same on every dial. Two long values chosen for one row can run into each other. Each cell's **Configure** button shows how it shows its item, in place of the plugin settings, **Reset** there brings back the defaults, and **Back** shows the plugin settings again where they were scrolled to:

- The identification is made of two parts, each the model, the ID, the name given in the plugin settings, or empty, joined by " - " when both have text. A lamp with no name shows its model and ID for its name, and a part with no text is left out. Trimmed, it keeps to about half a row, ending in "…".
- The counter shows the lamp's place, alone, among every lamp, or among the lamps of its model, as "1 of 2", "1/2", "1-2" or "1 2".
- The temperature and the brightness, in % or in lumens, can each show their unit and their icon. A left cell reads icon, value and unit from its left edge, and a right cell value, unit and icon up to its right edge. The lumens show the brightness's sun, and no icon by default.
- The power shows a label for each state, "On", "ON", "●" or "I" when the lamp is on, and "Off", "OFF", "○" or "O" when it's off, in a text style, or in a color and a weight of its own.

Each cell's **Font style**, in its editor, picks the [text style](#text-styles) it shows in, and each of the power's states picks its own. The temperature's and the brightness's icons take their cell's color.

### Text styles

Under "Text styles", the plugin settings set the dials' four styles, the same on every dial: Primary, for every text by default, but on the lamp a dial starts on in a color of its own (see [Lamp screens](#lamp-screens)), Secondary, toned down, for "OFF" by default, Accent, to draw the eye, and Alert, for something wrong. Each takes a color, a weight, Normal or Bold, and a size from 16 to 22 px, and its **Reset** button brings back its defaults. A lamp screen's text takes all three (see [What a lamp screen shows](#what-a-lamp-screen-shows)), and the main screen's title, icon, value and bar only the color (see [The main screen](#the-main-screen)).

## Steps

### Where a step stops

A dial turns, and an Up or Down key steps, by the step in its settings, and stops on the multiples of that step counted from the bottom of the range (0% or 2700 K), the same values going up as going down. From a value between two of them, such as a lamp's cap or a key's preset, the first step goes to the next one in the direction of the turn. When the step doesn't divide the range, the last step to 100% or 6500 K is shorter.

### Lamps together or apart

By default, a turn on a dial's own screen, and a press of an Up or Down key, set every lamp to the same value, one step from the one the dial or key shows: the brightest lamp's brightness, or the highest temperature.

With "Each lamp steps from its own brightness" checked under "Lamps" in the plugin settings, each lamp steps from its own brightness instead, so lamps set apart on their lamp screens stay apart. A lamp that reaches 0%, 100% or its cap stays there, while the others keep going, and the plugin remembers how far the lamp would have gone, so it comes back with them and the lamps keep their difference. Once every lamp is at its end, turning further does nothing. Setting a lamp any other way through the plugin, or restarting the plugin, forgets how far it would have gone. Lamps that keep their difference each step along the multiples of the step, so their difference can change by up to a step on the first turn.

Every dial and key that sets or steps the brightness shares that setting, and those of the temperature share one of their own, so the lamps can keep their brightness apart while their temperature stays matched.

## The plugin settings

Every settings page, on a key or a dial, starts with a **Plugin settings** button, which shows the plugin's own settings in place of the action's, and **Back** returns to them. They come in sections, by what the settings reach. Every dial and key shares these settings.

### Lamps

"Lamps" lists the lamps the plugin knows, each by the end of its id and its model, with a field for its name, up to 24 characters, an Identify button that blinks it, and a trash can that forgets it. The plugin gives each lamp an id from its serial number, which it never shows, so the 4 characters under ID match nothing printed on the lamp: Identify tells which lamp a row is, and a name keeps it told apart everywhere else. Every list of the lamps, on the Deck and on the pages, comes in the order of their ids.

**Find lamps** adds the lamps connected that the plugin doesn't know yet (see [The lamps the plugin controls](#the-lamps-the-plugin-controls)). The table greys out the lamps the plugin didn't find the last time it looked, with "Not found" in place of Identify: at the last Find lamps, or the last press, turn or tap that reached the lamps. A lamp's trash can takes its name too, until Find lamps finds it again. A name is the lamp's, not a key's: every key shows it. Emptying the field takes it away.

**Re-sync lamps**, under the table, brings the lamps and the plugin back in step after a lamp was changed another way, such as with its own buttons, in the direction chosen above it under "Re-sync":

- "Sync the plugin to the lamps", the default, reads every lamp the plugin knows that's connected, and every key and dial shows what each one reports. It changes nothing on the lamps.
- "Sync the lamps to the plugin" sets every lamp the plugin knows that's connected back to the power, brightness and temperature the keys and dials show.

A lamp that isn't plugged in is left alone either way. With "Each lamp steps from its own brightness" or temperature, a lamp the re-sync finds at another value steps from there, rather than from where its last step left it.

Under the lamps come how each lamp steps, for its brightness and its temperature (see [Lamps together or apart](#lamps-together-or-apart)), and "Blink length", how long a blink lasts, for Identify and on the lamp screens, from 300 ms to 1.5 s. Its default, 400 ms, suits dim lamps: a lamp fades as it goes off, so a bright lamp among others that stay on needs a longer blink to show.

### Keys

"Keys" holds whether every key takes in lamps added later (see [Picking a key's lamps](#picking-a-keys-lamps)), and, under "Turn on", whether each kind of key turns its lamps on as it changes their brightness or temperature, such as "Set Brightness keys turn lamps on". Each is unchecked by default, so a key changes the brightness or the temperature alone, and a lamp that's off stays off. A key's own page has its own checkbox, "This key turns lamps on", under "Turn on", for that key alone, and the plugin settings' checkbox for its kind of key shows a bar when its keys differ. A click there gives every key of that kind the same choice again.

### Dials

"Dials" starts with the text styles, which both screens take (see [Text styles](#text-styles)). It holds, under "Main screen", whether a turn on a Brightness or a Temperature dial's own screen turns its lamps on as it changes them, the title each action's dials show, unless a dial has its own, and the text styles its title, its icon, its value and its bar take their colors from (see [The main screen](#the-main-screen)). Under "Lamp screens" come the lamp screens' blink for every dial (see [Lamp screens](#lamp-screens)), whether a turn on a lamp screen turns its lamp on, and what they show (see [What a lamp screen shows](#what-a-lamp-screen-shows)). The settings that turn lamps on are unchecked by default, like the keys', and a dial's own page has its own checkboxes for that dial alone: "This dial turns lamps on", under "Turn on", for its main screen, and "This dial turns the lamp on", under its blink, for its lamp screens.

## When something doesn't work

A key or a dial shows Stream Deck's alert indicator when it can't do all it was asked:

- One of a key's lamps isn't connected: a lamp the plugin knows that the key acts on, whether checked on its page, taken in with every lamp, or in any group of a scene. The lamps connected are still set. A lamp left unplugged makes every key that acts on it show the alert, until it's plugged back in, or forgotten in [the plugin settings](#lamps). A dial's main screen acts on the lamps connected, so a lamp unplugged makes it show none.
- None of the lamps connected is one the plugin knows (see [The lamps the plugin controls](#the-lamps-the-plugin-controls)).
- Its settings page checks no lamp, or leaves out every lamp connected (see [Picking a key's lamps](#picking-a-keys-lamps)).
- A lamp fails. The others don't wait for it: they're still set.
- A Beam LX doesn't give its serial number, on a key that acts on every lamp, or on every lamp but some, since it could be one of them.
- On a lamp screen, a tap with no lamp connected, a hold whose lamp can't be blinked, or a turn or a push once its lamp is unplugged.

A Power key shows the alert once it has redrawn its state, which would cover the alert otherwise (see [Stream Deck keys][keys]). With none of their lamps connected, a Power key shows off, and the dials and the Up and Down keys show a dash.

When a lamp takes a change but doesn't answer what it did, such as on a USB error, the plugin asks again, and when the lamp still doesn't answer, it shows what was asked for. The lamp may then be elsewhere until the next change made through the plugin, or until **Re-sync lamps**, in [the plugin settings](#lamps), brings them back in step.

If something else doesn't work, [an issue][issues] with the plugin's log helps. The logs are in the plugin's folder, newest in `litra.log`:

- On macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.daczarne.litra.sdPlugin/logs/`
- On Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\com.daczarne.litra.sdPlugin\logs\`

They name each lamp by its model and the end of its id, never by its serial number. An error's stack, which some lines carry, shows where the plugin is installed, with your user name on the computer, which you may want to replace before posting.

[hardware]: ../../README.md#supported-hardware
[installing]: ../../README.md#installing
[issues]: https://github.com/daczarne/streamdeck-litra/issues
[keys]: ../elgato_sdk/keys.md
