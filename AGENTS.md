# Working in this repository

This file is the rulebook for any coding agent working here — ChatGPT/Codex
reads it by convention, and it carries the same rules as `CLAUDE.md`, which
Claude Code reads. If the two ever disagree, `CLAUDE.md` wins; fix the drift
in the same commit that notices it.

## What this is

A browser real-time-with-pause tactical mech game. TypeScript (strict, with
`noUncheckedIndexedAccess`), Vite, React, Zustand, three.js, Zod, Vitest.
The design document is `IRONLINE_DESIGN.md`; the setting bible and all game
content live under `src/data`.

## Architecture — not negotiable

- `/src/sim` is pure and deterministic. It must never import from `/render3d`,
  `/ui`, or `/campaign`. ESLint enforces this.
- All randomness goes through `ctx.rng`. `Math.random()` is banned in `/sim`.
- Simulation runs at a fixed 20Hz tick. Rendering interpolates between ticks.
- No game statistic may be hardcoded in TypeScript. Chassis, weapons,
  equipment, pilots, missions, and maps are JSON under `/src/data`, validated
  by the Zod schemas in `/src/schema`. Adding content means adding a data
  file, not editing code.
- Files stay under ~400 lines; split before exceeding.
- Comments explain why, never what. Prefer explicit types at module
  boundaries.

## Commands

```
npm ci                 # install (respect the lockfile)
npm run dev            # dev server
npx tsc --noEmit       # typecheck
npx eslint .           # lint (includes the sim-purity import rules)
npx vitest run --exclude "**/balance.test.ts" --exclude "**/e2e/**"
                       # fast suite — exactly what CI runs
npx vitest run src/sim/balance.test.ts
                       # balance gate: ~13 minutes of mirror matches
node tests/e2e/playthrough.mjs
                       # browser playthrough (~100 checks); spawns its own
                       # vite on port 5183; needs a Chromium that Playwright
                       # can find
npm run build          # production build (runs tsc first)
npm run build:single   # self-contained single file → dist-single/ (itch.io)
```

## Testing discipline

- Every change under `/src/sim` needs a passing Vitest, and the determinism
  test must stay green: identical seed → identical outcome.
- **The balance gate.** Any change to `/src/sim` or to sim-affecting data
  (weapons, chassis, rules, mission tuning) requires
  `npx vitest run src/sim/balance.test.ts` AND
  `npx vitest run src/campaign/acceptance.test.ts` to pass — run against the
  FINAL state of your change, after your last edit, never in parallel with
  further editing. If you edit anything after the run, run it again.
- `src/data/missions/mirror_ridge.json` keeps `startingResourcePoints: 0`.
  It is the balance fixture; the mirror match depends on it.
- UI-only and doc-only changes need the fast suite, not the balance gate.

## How agents share this repository

Claude Code and Codex both work here, never at the same time. The rules that
make that safe:

1. **Start from fresh `main`.** `git fetch origin main` and branch from it.
   Do not build on the other agent's unmerged branch, and do not rewrite any
   history you did not author in the current session.
2. **Branch names carry the author.** Claude Code works on `claude/...`
   branches; Codex works on `codex/...` branches. Humans use whatever they
   like.
3. **CI is the shared gate.** Push the branch and let `.github/workflows/ci.yml`
   run: typecheck, lint, fast tests, both builds. Do not merge red.
4. **Merging to `main` is deploying.** Cloudflare builds and publishes the
   site straight from `main` — there is no separate deploy step. Merge only
   work you would put in front of a stranger, because you are.
5. **No model names in code or docs.** Source, comments, data, and docs
   never name the AI model that wrote them. Attribution trailers appended to
   commit messages by the agent's own tooling are the one exception. Commit
   summaries are single imperative lines in the voice the log already uses.
6. **Leave a trail.** If you stop mid-task, push the branch and describe the
   state in the last commit message rather than leaving work only on disk —
   the next session (yours or the other agent's) starts from the repo, not
   from your memory.
