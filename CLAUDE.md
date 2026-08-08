# Working rules for this repository

## Architecture

- `/sim` is pure and deterministic. It must never import from `/render`, `/ui`,
  or `/campaign`. This is enforced by ESLint and is not negotiable.
- All randomness goes through `ctx.rng`. `Math.random()` is banned in `/sim`.
- Simulation runs at a fixed 20Hz tick. Rendering interpolates.

## Data

- No game statistic may be hardcoded in TypeScript. Chassis, weapons, equipment,
  pilots, missions, and maps live in `/data` as JSON and are validated by Zod
  schemas in `/schema`.
- Adding content means adding a data file, not editing code.

## Testing

- Every change to `/sim` requires a passing Vitest.
- Determinism test must pass before any commit: identical seed → identical outcome.
- After any balance change, run the headless harness and report the delta.

## Style

- Files under ~400 lines. Split before exceeding.
- Prefer explicit types over inference at module boundaries.
- No comments explaining what code does; comments explain why only.

## Process

- Work one build phase at a time. Do not start a phase until the previous
  phase's acceptance test passes.
- When a phase is complete, state the acceptance test result explicitly.
