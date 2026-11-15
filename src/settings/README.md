# settings

The backend's upper layer: what Stream Deck keeps for the plugin, each key's and dial's settings and the global ones, and the plugin's side of the page that edits them. Its modules import from `../lamps/`, never from the frontend.

1. `schemas.ts`: each setting's default and valid values, against which every action and the global settings read what Stream Deck sends.
2. `global-settings.ts`: the global settings, read whenever a page saves them, the lamps the plugin knows among them, which only the plugin writes.
3. `plugin-settings-page.ts`: the answers to the plugin settings page (`ui/plugin-settings.js`), which asks the plugin to find, identify, rename and forget the lamps, and which are connected.

Storing a setting is the backend's work, even when the setting is about what the Deck displays, such as the lamp screens' cells: what the value is turned into on the Deck is the frontend's.
