# IRONLINE

Real-time-with-pause tactical mech combat. See [`IRONLINE_DESIGN.md`](IRONLINE_DESIGN.md)
for the full design and build specification; [`CLAUDE.md`](CLAUDE.md) holds the
agent working rules.

## Layout

```
src/sim       pure, deterministic simulation (no DOM, Pixi or React)
src/data      all game content as JSON
src/schema    Zod schemas + the validating content loader
src/render    PixiJS tactical renderer (Phase 2)
src/ui        React shell (Phase 3)
src/campaign  economy, salvage, roster, time (Phase 4)
src/headless  CLI balance harness (Phase 1)
tests         cross-cutting architecture tests
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
- Phase 2 — Tactical renderer: next.
