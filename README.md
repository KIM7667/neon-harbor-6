# NEON HARBOR

[![Make GTA 6 bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/KIM7667/neon-harbor-6/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/KIM7667/neon-harbor-6/reward.svg)](https://make.fun/bounty/gta6-01)

SPDX-License-Identifier: MIT

An original open-world crime game that plays in a desktop browser from static
files - no build step, no network. One night in Neon Harbor, a neon-lit dockside
city: steal cars, run six jobs for Sal the fixer, shake the Harbor PD, and catch
the last boat out. Built with [three.js](https://threejs.org/), vendored locally
under `game/vendor/`, so the game runs fully offline.

## Play

Serve the `game/` folder with any static server - this repo ships one:

```
node serve.ts            # then open http://localhost:8080
```

Or run the entrypoint program, which copies `game/` and `screenshots/` to the
output directory and writes `dossier.json` there:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Click **START THE NIGHT** - the mouse locks for looking around. Progress
(mission and cash) auto-saves to `localStorage`; CONTINUE on the title screen
picks the night back up.

## Controls

- **W A S D** - move / drive
- **Mouse** - look
- **Shift** - sprint
- **E** - enter / exit car
- **Mouse click** - shoot
- **F** - melee punch
- **Space** - handbrake
- **M** - mute

## What's in the city

- A seeded 6x5-block neon harbor: towers with lit windows and neon signs, a park,
  a plaza, street lights, a dock with a crane and a container yard, and the water
  with the last boat out - the same city every visit
- Parked cars you can steal, moving traffic that follows the street grid, and
  pedestrians who pace the sidewalks and run from trouble
- A 0-5 star wanted system: Harbor PD cruisers spawn, chase, ram, and work a bust
  meter when they corner you; heat cools when you break their line of sight
- Shooting and melee combat with hit feedback, wreckable cars, synthesized
  WebAudio sound (engine, siren, gunshots, horns - no audio files)
- Six scripted jobs with markers, timers, rewards and a victory ending:
  First Wheels, Hot Delivery, Turf Trouble, Harbor Pickup, Lose the Heat,
  The Getaway
- HUD with health, cash, wanted stars, objective tracker and a live minimap

## Self-test

Open `game/index.html?test=1` - a scripted playthrough drives the exposed
`window.NEON` API (spawn, steal, drive, shoot, police response, all six jobs,
victory) and reports `NEON TEST n/n PASS` in the document title and console.
Screenshot scenes for the entry live behind `?shot=start|chase|mission|dock`
(see `shots.json`).

## Files

- `main.ts` - the entrypoint: copies `game/` + `screenshots/` out and writes the dossier
- `serve.ts` - a tiny static server for local play
- `vendor/makefun-game.ts` - the kit's dossier library, unchanged
- `game/index.html` - page, HUD and screens
- `game/src/` - the game itself, one job per file: `config.js` (city shape and
  tuning), `random.js` (seeded RNG), `city.js` (world building), `vehicles.js`
  (cars, traffic, police), `people.js` (pedestrians, thugs), `missions.js`
  (Sal's six jobs), `audio.js` (synthesized sound), `hud.js` (HUD and minimap),
  `shots.js` (screenshot scenes), `main.js` (the loop and the NEON API)
- `game/vendor/three.min.js` - three.js r160, vendored

## License

MIT - see `LICENSE`.
