# IRONLINE

Real-time-with-pause tactical mech combat. See [`IRONLINE_DESIGN.md`](IRONLINE_DESIGN.md)
for the full design and build specification; [`CLAUDE.md`](CLAUDE.md) holds the
agent working rules; [`docs/HOSTING.md`](docs/HOSTING.md) covers publishing it.

**Play it:** published to Cloudflare Pages from `main` on every push, and
playable in Safari on a phone as well as on a desktop. See
[`docs/HOSTING.md`](docs/HOSTING.md) for the build settings and how to deploy
without pushing.

## Layout

```
src/sim       pure, deterministic simulation (no DOM, Pixi or React)
src/data      all game content as JSON
src/schema    Zod schemas + the validating content loader
src/render    shared art description — blueprints, palettes, silhouettes
src/render3d  Three.js tactical renderer — reads sim state, never mutates it
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
  Blowout Cells, and an advance-and-engage placeholder AI. `npm run sim` runs complete
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
  rights, credit economy with pilot salaries, salvage resolution keyed to how
  each enemy was taken out, refit from stores, repair queue with day
  advancement, pilot XP and injuries, and save/load that round-trips exactly
  including the campaign random stream.
- **Phase 5 — Objectives & support: complete.** Mission scripting from JSON —
  capture zones, five objective types, and triggers on elapsed time, zone
  capture, objective completion or losses, firing spawns, resource awards,
  messages and reveals. Resource Points earned from zones and objectives pay
  for sensor probes, air strikes, repair trucks, or an authored mission reserve.
  Mission success and failure conditions, a briefing screen and an in-battle
  objective tracker.
- **Phase 6 — AI depth & balance: complete.** Utility-scoring target selection,
  lance focus fire, cover and elevation seeking, flanking, graduated heat
  discipline that sheds the least efficient weapon group rather than going dark,
  called shots at the legs to leave salvage on the field, withdrawal and
  disengagement, and four difficulty tiers that change behaviour and pilot skill
  but never hit points or damage. Torso twist so guns bear independently of the
  hull. Content pass to twenty-eight weapons, ten equipment items and eight
  chassis spanning 25 to 100 tons. `npm run sim` reports damage-per-ton-per-heat
  against each class median.
- **Setting.** IRONLINE is set on Tessell, where a departed colonial Compact left
  behind four thousand kilometres of self-repairing freight rail that everything
  else on the planet now depends on. Nobody can build a mech; every machine is a
  depot hull cut apart and rebuilt. The world, its four employers and the informal
  code of the line are in `src/data/lore`, readable in-game under Field Manual.
- Phase 7 — Polish: in progress.

### Phase 6 acceptance

Both criteria are asserted in `src/sim/balance.test.ts`:

- **Weapon balance.** `damagePerTonPerHeat = dps / (tonnage + heatPerSecond /
  dissipationPerSink)` — a mount costs its own tonnage plus the heat sinks
  needed to keep it firing, and accuracy is folded into the numerator so pulse
  and Seeker launchers pay for their aim. Cooldown cancels out, leaving rate of
  fire free for feel. All 28 weapons land within 5% of their class median
  against a ±20% band.
- **AI strength.** `mirror_ridge` fields identical lances on mirrored spawns;
  the tactical controller and the `baseline` controller (nearest target, range
  bracket, heat discipline — nothing else) swap sides every other run so no
  corner of the map flatters either. The tactical AI takes 57.5% of 40 runs.

Known finding: light mechs are near-unsurvivable in a stand-up 4v4, because
`lanceFocus` correctly concentrates on the weakest target. That is doctrine
working as intended rather than a balance fault — lights belong on scouting and
flanking work — but it means a line lance should not be built around one.

## Mission prep

Skirmishes are outfitted at the briefing: each berth has a design picker
(stock builds plus anything saved from the bay), a pilot picker, and a
**Customise** button that opens the bay on that machine. The lance must fit
the mission's drop tonnage, and the loadout is remembered per mission.

A campaign contract is fought with what you decide to take. Signing one and
pressing **Deploy** opens the dropship manifest rather than launching:

- **The profile** — how many berths the dropship has, how many tonnes it will
  carry, and what the contract is. The lance is limited by weight as well as by
  berths, so fielding the hundred-tonne hull means leaving something behind.
- **The crew** — every fit pilot, what their skills buy in the units you see on
  the field, and which machine they are in. Pilots can be reseated into any hull
  and held back from a drop.
- **The loadout** — **Refit** opens the bay on that machine, stocked from the
  company's own stores. What you take off goes back on the shelf; what you bolt
  on comes off it; a refit the company cannot pay for is refused.

Everything there is a trade. A heavier machine costs a berth's worth of
allowance, a better gun costs tonnage that was buying armour, and the pilot who
sees furthest is not the one who shoots straightest.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select a friendly mech; Shift-click toggles it, and Shift-drag adds a box selection |
| Right click | Attack a hostile or move to open ground; hold Shift on ground to append a waypoint |
| 1–9 / Ctrl or Cmd+1–9 | Recall a control group / bind the current selection to one |
| E | Select the whole lance |
| Numbered weapon badge | Toggle that weapon group across the current selection |
| T | Reactor governor (heat safety) on or off |
| Space | Pause / resume — orders are still accepted while paused |
| M / R / A / F / C / J | Move, Run, Attack Move, Attack, Called Shot, Jump |
| H / G | Hold Fire / hold position |
| Q / V / X | Target nearest contact, pilot ability, alpha strike |
| Tab | Cycle through your lance |
| Arrow keys / Centre | Pan or centre the selection · wheel zooms under the pointer · middle-drag pans · minimap click jumps |
| , / . | Lower / raise battle speed |
| P | Toggle the performance graph |
| Esc | Cancel targeting and clear the selection |

Shift also appends destinations placed with Move, Run, or Attack Move. Support
calls are picked from the palette and then placed with a left click; an air
strike uses a press-drag to set its run-in. Esc cancels an armed call.

On touch, tap a friendly to select it, open ground to move, or a hostile to
attack. Drag the ground to pan, pinch around the fingers to zoom, or tap Centre
to find the selection. Commands take their next target from a tap. Tap an armed
support call again to cancel it; air strikes run from the lance through the
point tapped.
