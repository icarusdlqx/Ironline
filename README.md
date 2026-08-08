# IRONLINE

Real-time-with-pause tactical mech combat. See [`IRONLINE_DESIGN.md`](IRONLINE_DESIGN.md)
for the full design and build specification; [`CLAUDE.md`](CLAUDE.md) holds the
agent working rules.

## Layout

```
src/sim       pure, deterministic simulation (no DOM, Pixi or React)
src/data      all game content as JSON
src/schema    Zod schemas + the validating content loader
src/render    PixiJS tactical renderer — reads sim state, never mutates it
src/ui        React shell, Zustand store, fixed-step game loop and input
src/ui/mechbay loadout editor, construction validation, heat calculator
src/campaign  economy, salvage, refit, repair, roster, time, save/load
src/headless  CLI balance harness
tests         architecture tests + the browser playthrough harness
```

## Commands

```sh
npm install
npm test        # Vitest: determinism, schemas, architecture boundaries
npm run lint    # ESLint, including the /sim purity rules
npm run typecheck
npm run dev     # Vite dev server

# Headless balance harness
npm run sim -- --iterations=100 --seed=1337
npm run sim -- --mission=skirmish_ridge --iterations=500 --seed=1337 --out=./reports/skirmish.json

# Drive the real page in Chromium and assert the Phase 2 acceptance test
npm run verify:ui
```

Harness flags: `--mission`, `--iterations`, `--seed`, `--max-ticks`, `--out`, `--verbose`.
Iteration *i* runs on seed `<seed>:<i>`, so any single battle can be replayed on its own.

## Build status

- **Phase 0 — Foundation: complete.** Vite + TypeScript strict, ESLint with the
  `/sim` import boundary and `Math.random` ban, Vitest, seeded xorshift128 RNG
  with a determinism test over 10,000 draws, Zod schemas for chassis/weapon/
  equipment, and three chassis, eight weapons and six equipment items in
  `src/data`.
- **Phase 1 — Headless simulation core: complete.** Terrain grid, A* pathfinding,
  locomotion with facing and turn rates, line of sight with obstruction and
  elevation, weapon cooldowns, to-hit and hit location, damage with transfer and
  location destruction, heat with shutdown, ammo tracking and explosions with
  CASE, and an advance-and-engage placeholder AI. `npm run sim` runs complete
  4v4 battles and prints a results table.
- **Phase 2 — Tactical renderer: complete.** PixiJS tilemap with elevation
  relief, chassis-silhouette mechs with facing and component-loss damage state,
  selection, move/run/attack/called-shot orders, beams and tracers and arcing
  missiles, explosions and smoke, fog of war with remembered ground and
  last-known-position ghosts, paper-doll damage display, heat bar with threshold
  markers, weapon groups with cooldown rings, camera pan/zoom, and pause that
  freezes the sim while still accepting orders.
- **Phase 3 — Mechbay: complete.** Construction weight tables in `/data/rules`,
  a loadout calculator that enforces tonnage, slots, hardpoint types, armour
  maxima and heat-sink minimums, drag-to-hardpoint editing with live validation,
  per-location armour sliders, a heat efficiency calculator verified against
  headless sim runs, and build save/load/export. All seven shipped designs are
  legal builds.
- **Phase 4 — Campaign shell: complete.** Node-based operational map with
  branching prerequisites, contract negotiation trading payout against salvage
  rights, C-bill economy with pilot salaries, salvage resolution keyed to how
  each enemy was taken out, refit from stores, repair queue with day
  advancement, pilot XP and injuries, and save/load that round-trips exactly
  including the campaign random stream.
- Phase 5 — Objectives & support: next.

## Controls

| Input | Action |
|---|---|
| Left click | Select a mech (shift to add), or confirm a queued order |
| Right click | Attack the enemy under the cursor, or move there (shift to run) |
| Space | Pause / resume — orders are still accepted while paused |
| M / R / F / C | Move, Run, Attack, Called Shot |
| H / G | Hold Fire, Guard (stop) |
| 1–4 | Toggle a weapon group |
| Tab | Cycle through your lance |
| Arrows / WASD | Pan · wheel zooms · middle-drag pans |
