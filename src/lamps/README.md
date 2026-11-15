# lamps

The backend's bottom layer: the physical lamps. Its modules import nothing from the rest of `src/` but `../logging.ts`.

1. `lamp.ts`: `Lamp`, the plugin's state for one lamp it knows, plugged in or not, which decides what the lamp is sent.
2. `connection.ts`: `LampConnection`, one lamp plugged in, opened for one operation, and the only module that imports `litra`.
3. `selection.ts`: which lamps an operation acts on, or a key or dial shows.
4. `manager.ts`: the lamp manager, which the actions ask to change the lamps, one operation at a time.

`docs/architecture.md` explains how they fit together, and why.
