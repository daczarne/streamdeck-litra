# integration

The tests that cross modules, running the real `litra` against emulated lamps: `litra.test.ts` checks its protocol, and `actions.test.ts` drives the actions through the real lamp manager, from `../plugin.ts`, started afresh for every test. `vitest.config.mjs` runs `actions.test.ts` once on Beams and once on Beam LXs.
