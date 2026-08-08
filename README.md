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
```

## Build status

- **Phase 0 — Foundation: complete.** Vite + TypeScript strict, ESLint with the
  `/sim` import boundary and `Math.random` ban, Vitest, seeded xorshift128 RNG
  with a determinism test over 10,000 draws, Zod schemas for chassis/weapon/
  equipment, and three chassis, eight weapons and six equipment items in
  `src/data`.
- Phase 1 — Headless simulation core: next.
