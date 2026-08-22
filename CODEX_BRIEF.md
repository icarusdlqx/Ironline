# Work board: presentation layer

This is the standing brief for graphics, environment, sound, and content work.
`FACTION_PLAN.md` holds the staged faction rebuild — the larger piece of work,
and the one to follow first when it is live.
**Read `AGENTS.md` first** — it holds the architecture rules, the commands, and
the branch/deploy workflow, and none of it is optional. This file says *what*
to work on and *how to know it worked*.

Take **one task per branch, one branch per pull request.** Tasks here are
deliberately independent so that several can be in flight without collisions.
Do not batch three tasks into one branch; a reviewer needs to be able to look
at a change and see one intention.

## How to see your own work

This matters more than anything else in this file. The browser harness drives a
real playthrough and drops ten screenshots:

```
node tests/e2e/playthrough.mjs        # ~100 checks, writes reports/e2e/*.png
SHOT_DIR=./reports/before node tests/e2e/playthrough.mjs
```

`reports/e2e/01-boot.png` … `10-objectives.png` cover boot, selection, a paused
order, a battle outcome, both mechbay states, the campaign map, a campaign
battle, the support palette, and objectives. **Capture a before set, make your
change, capture an after set, and look at both.** A visual change that you have
not looked at is not finished. Attach the pair to the pull request.

For anything the harness does not reach, `npm run dev` serves the game and
`window.__ironline = { engine, world, useGame }` is live in the console.

## Hard boundaries

Breaking one of these wastes a review cycle, so they are worth reading twice.

- **Never edit `src/sim/**`.** It is pure and deterministic, and nothing on
  either board requires changing it. If a task appears to, stop and say so in
  the pull request instead of reaching in. Rendering and audio read the world;
  they never write it.
- **Changing statistics means running the balance gate.** Weapon, chassis,
  equipment and mission-tuning data feed the simulation, so editing any of it
  puts the 200-battle suite on you:
  `npx vitest run src/sim/balance.test.ts` (~13 min) and
  `npx vitest run src/campaign/acceptance.test.ts`. Run them **after your last
  edit**, never alongside further editing — a gate run against a state you then
  changed has told you nothing. Say the result in the pull request.
- **Never edit `src/data/missions/mirror_ridge.json`.** It is the balance
  fixture. Its `startingResourcePoints` stays `0`.
- **No new npm dependencies.** The single-file build inlines everything and
  runs under a strict CSP. A tempting library is a hard no; write the twenty
  lines instead.
- **No external URLs for assets** — no CDN fonts, no remote images. The game
  has to run from a single file with no network.
- **`public/` does not exist in the itch.io build.** `tools/build-single.mjs`
  folds only `assets/*.js` and `*.css` into the one-file output, so anything
  dropped in `public/` and referenced by URL will 404 there. Art that must
  appear in-game has to be `import`ed from `src/` (which inlines it as a data
  URI, so mind the file size) or drawn procedurally.
- **Do not rename the `ironline.*` localStorage keys.** Renaming them silently
  destroys every existing player's save and settings.
- Files stay under ~400 lines. `src/ui/mechbay/Mechbay.tsx` is at 700 and wants
  splitting, not growing.
- Comments explain **why**, never what. Match the prose voice already in the
  files — it is dry and concrete, not chatty.
- Never name an AI model in code, comments, data, or docs.

## Definition of done, every task

```
npx tsc --noEmit
npx eslint .
npx vitest run --exclude "**/balance.test.ts" --exclude "**/e2e/**"
node tests/e2e/playthrough.mjs
```

All four green, plus before/after screenshots for anything visual. Then push
`codex/<short-name>` and open a pull request. **Do not merge to `main`
yourself** — `main` deploys straight to the live site, so a human presses that
button.

---

# The board, in priority order

**Much of this board is already done** — atmospheres, ground clutter, the sound
pass, the team-colour rework and the training flow all landed. Check the current
state of a task before starting it, and skip what is finished. `FACTION_PLAN.md`
is the live work.

## 1. Weather and light: four new atmospheres

**Files:** `src/data/atmospheres/*.json` (new files only), plus a matching
entry in `AMBIENT_PROFILES` in `src/ui/audio.ts` (~line 759).

Atmospheres are pure data and auto-register — `src/schema/load.ts` globs the
directory, so a new JSON file needs no code change. The shape, validated by
`src/schema/atmosphere.ts`:

```json
{ "id": "...", "name": "...", "sky": "#hex", "exposure": 1.18,
  "fog":  { "kind": "linear", "colour": "#hex", "near": 800, "far": 2600 },
  "sun":  { "colour": "#hex", "intensity": 2.1,
            "direction": { "azimuthDegrees": 200, "elevationDegrees": 16, "distance": 1300 } },
  "fill": { "colour": "#hex", "intensity": 0.7, "direction": { ... } },
  "hemisphere": { "sky": "#hex", "ground": "#hex", "intensity": 1.35 },
  "terrainTint": { "colour": "#hex", "strength": 0.16 } }
```

Read all five existing files before writing one. Wanted: **dust storm** (short
fog, high ground bounce, sun barely present), **rain** (flat grey light, cool
tint, low exposure), **dawn** (long low sun, cold shadows, warm rim), and
**industrial smog** (sodium-lit, sickly, a real drone in the audio profile).

Each one needs an `AMBIENT_PROFILES` entry keyed by the same id, or it silently
falls back to `overcast_day` — that fallback is the bug most likely to slip
through here. Point a map at each new atmosphere via `atmosphereId` in
`src/data/maps/*.json` to shoot it, but revert the map before the pull request
unless the change genuinely suits that map.

**Done when:** each atmosphere is legible and distinct in a screenshot, and
none of them makes enemy mechs hard to pick out against the ground. That last
clause is a gameplay constraint, not a style note — atmosphere never wins over
readability.

## 2. Environment density: more things on the ground

**Files:** `src/render3d/props.ts` (279 lines — keep it under 400 or split).

Five prop kinds exist: `canopy`, `trunk`, `boulder`, `crag`, `block`. Every
forest is the same conifer and every ruin is the same box. Add kinds — dead
snags, rubble piles, pylons, fence lines, burnt-out hulks — placed off the same
deterministic `hash(column, row, salt)` so a map looks identical every load.

Respect the existing machinery rather than working around it: instanced meshes,
per-kind caps (`CAPS`), incremental reveal through `tileInstances` with
`addUpdateRange`. That reveal path was written to fix a real stutter when mechs
walked into forest; a full buffer re-upload brings it straight back.

**Done when:** the four maps look meaningfully different from each other, draw
calls have not climbed (P toggles the perf overlay — check the `dc` figure),
and walking a lance into dense cover produces no spike in the overlay's third
caption line.

## 3. Sound: cover the events that are currently silent

**Files:** `src/ui/audio.ts` (778 lines — split if you approach 400 more).

`consume()` handles `weapon_fired`, `projectile_hit`, `critical_hit`,
`ammo_explosion`, `mech_destroyed`, `shutdown`, `restart`, `jump_started`,
`jump_landed`, `zone_captured`, `objective_settled`. Silent today, and each one
is a moment the player should hear:

- `ability_used` — a pilot's one active ability firing (see `src/sim/events.ts`)
- `alpha_strike` — the whole loadout at once; this should sound like a mistake
  you chose to make
- knockdowns and falls — a hundred tonnes hitting the ground
- heat: a rising note as a mech approaches capacity, so the player feels the
  shutdown coming instead of reading it
- `mission_message` — a quiet radio blip, easy to ignore, never a klaxon

Everything is procedural through the Web Audio graph — no samples, no files.
Read how the existing weapon voices are built before adding more; the vocabulary
is already there.

Also: `footfall()` ignores terrain, so a mech sounds identical on road, in
water, and through forest. The terrain is right there in `world.terrain`.

**Done when:** a battle is legible with the screen turned away, and nothing
clips or accumulates nodes across a campaign's worth of battles. `destroy()`
exists because browsers cap live AudioContexts — do not leak sources.

## 4. Combat feedback: damage floaters and hit reads

**Files:** `src/render3d/effects.ts`, `src/ui/Battle.tsx`, `src/ui/styles.css`.
**Do not touch `src/sim`.**

Half of an old task, deliberately left: when you shoot something, too little
comes back. Wanted — a damage number rising off the hit location and fading; a
distinct read for armour hit versus internal structure versus a critical; a
clear visual for a shot that missed, so a whiffed volley does not look like a
volley that never fired.

The events are already emitted and already carry what you need. `ScarLayer` and
`SmokeLayer` in `effects.ts` show the pooling pattern to follow — fixed
capacity, no per-frame allocation. Steady-state allocation was hunted down
deliberately in this codebase; floaters that allocate per hit will undo it.

**Done when:** a firefight reads at a glance, and the perf overlay's `other`
figure has not moved during heavy fire.

## 5. Colour and accessibility

**Files:** `src/render/palette.ts` (50 lines), `src/ui/styles.css`.

`TEAM_COLOURS` is `[blue, red, gold, green]` — red/green side by side is the
single most common colourblind failure, and this game asks the player to tell
friend from enemy at a glance under fog and dusk lighting. Rework the ramp so
teams stay separable for deuteranopia and protanopia, using lightness and
shape-adjacent cues rather than hue alone.

While in here: honour `prefers-reduced-motion` for screen shake and camera
drop-in, and check the HUD's contrast against the panel colours.

**Done when:** a simulated deuteranope view of `02-selected.png` and
`07-campaign-battle.png` still tells the sides apart.

## 6. Two new maps

**Files:** `src/data/maps/*.json`, then a mission in `src/data/missions/` to
play them, then a campaign node in `src/data/campaigns/border_dispute.json`.

Maps are 40×40 grids: `tiles` (rows of legend characters) and `elevation` (rows
of numbers), `tileSize: 24`, legend `. open · r rough · f forest · w water ·
= road · b building`. Read `ridge_pass.json` and `the_causeway.json` first —
they are shaped around a tactical idea, not decorated.

Give each new map one idea a player can name: a river crossing where the fords
are the whole battle; a hillside where the high ground is real but exposed.
Elevation and forest both fight — cover blocks sightlines, height grants
advantage — so terrain is a tactical argument, not scenery.

Missions and campaign nodes are cross-validated by `src/schema/integrity.ts`,
so a dangling id fails loudly at load rather than at runtime. Keep new missions'
`startingResourcePoints` in the band the others use (200 for training, 400–700
mid-campaign, 900 for a base assault).

**Done when:** both maps are playable start to finish, the AI navigates them
without wedging, and the fast suite is green.

## 7. Weapon prose pass

**Files:** `src/data/weapons/*.json` (`summary` fields only),
`src/data/equipment/*.json`, `src/data/chassis/*.json` (`lore`).

Every weapon was renamed off another franchise's designations — PPC became Arc
Projector, LRM became Longshot, Streak became Seeker, CASE became Blowout Cell,
and so on. The `summary` lines were written for the old names and now sit
slightly wrong: some describe a designation that no longer exists, and none of
the new names has earned its flavour yet.

Rewrite the summaries so each weapon reads like a thing soldiers actually carry
and complain about. Constraints: dry, specific, one or two sentences, no
marketing voice, and **never** reference another game's terminology. Keep every
`id` untouched — ids are load-bearing and appear in save files.

**Done when:** the mechbay dossier reads well end to end, and `LAUNCH.md`'s
scrub list still holds true (no franchise term has crept back in).

## 8. Store and icon art

**Files:** `public/icons/*`, plus new marketing art outside the build.

The PWA icons are placeholders. The itch.io page needs a capsule (630×500),
a cover, and a handful of clean screenshots. Two notes that matter:

- Keep art for the **page** out of the bundle entirely — it is upload material,
  not game content, so it belongs in a `marketing/` directory that Vite never
  touches.
- Anything that must render **in-game** has to be imported from `src/`, which
  inlines it into the 1.27 MB single file. Check the size delta before and
  after; do not let cosmetics double the download.

Prefer the in-engine look over illustration that the game cannot match — a
capsule promising fidelity the game does not have costs more in refunds and bad
reviews than it earns in clicks.

## 9. First ten minutes

**Files:** `src/data/missions/training_ground.json`,
`src/ui/campaign/*.tsx`, briefing copy.

First launches now default to Green difficulty because a stranger's opening
battle decides whether there is a second one. The rest of the funnel has not
had the same attention: the training mission, the first briefing, and the
mechbay's first impression all assume someone who already knows the genre.

Play it as a stranger — cleared browser profile, no context — and fix what
confuses. Copy changes, ordering, and what is on screen first are all in scope.
Mechanics changes are not.

**Done when:** someone who has never played a mech game can finish the training
mission without asking a question.

---

## If you finish the board

Good candidates, roughly descending: split `src/render3d/scene.ts` along its
seams (marker pooling, picking, vision gating) without changing behaviour; a
responsive pass so the game is playable on a tablet; per-chassis silhouette
refinement in `src/render/blueprint.ts` (1206 lines, authored per body plan, and
the mechbay screenshots make it verifiable); more pilots in `src/data/pilots/`.

If a task feels like it needs to touch `src/sim`, say so in the pull request and
stop there. That boundary is the whole reason two agents can work in this
repository without breaking each other's work.
