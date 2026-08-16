# IRONLINE — Design & Build Specification

A real-time-with-pause tactical mech combat game with campaign progression, salvage economy, and deep loadout customisation. Spiritual successor to MechCommander 2.

**Target platform:** macOS (Mac mini), browser-hosted, local dev server.
**Intended executor:** Claude Code, working phase by phase.

---

## 0. Design Pillars

Everything in this spec serves one of four pillars. If a proposed feature doesn't, cut it.

1. **The loadout is the puzzle.** Tonnage, hardpoints, heat, and ammo form a constraint system with no dominant solution. A good build is a *situational* build.
2. **How you kill matters.** Coring a mech destroys it. Legging it lets you tow the chassis home. Tactical decisions have economic consequences.
3. **Attrition is the real difficulty curve.** Pilots get injured, mechs need days in the bay, contracts have deadlines. Winning badly is a form of losing.
4. **The simulation is knowable.** Deterministic, seeded, headless-testable. No hidden fudging, no rubber-banding. Difficulty comes from enemy skill and composition, never from stat inflation.

---

## 1. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Type safety across a large data-driven system |
| Build | Vite | Instant HMR, zero config |
| Tactical render | PixiJS v8 (WebGL) | Fast 2D sprite/particle rendering |
| Shell UI | React 18 | Mechbay, briefing, campaign screens |
| App state | Zustand | Simple, outside React render cycle |
| Schema validation | Zod | All JSON content validated at load |
| Tests | Vitest | Sim unit tests + headless battle harness |
| Persistence | JSON → localStorage + file export/import | No backend needed |

**Explicitly not used:** any game engine, any physics library, any networking. Single player, local, offline.

Optional later: Tauri wrapper for a native `.app`. Not in scope for phases 0–7.

---

## 2. Architecture

```
/src
  /sim              # PURE. Deterministic. No DOM, no Pixi, no React.
    rng.ts          # Seeded PRNG (xorshift128)
    world.ts        # World state, tick loop
    entity.ts       # Mech instances, components, state machine
    movement.ts     # Pathfinding, locomotion, facing
    pathfind.ts     # A* over terrain cost grid
    los.ts          # Line of sight, cover, elevation
    combat.ts       # To-hit, hit location, damage application
    heat.ts         # Heat generation, dissipation, shutdown, ammo explosion
    ai/             # Utility-scoring enemy AI
    events.ts       # Sim event bus (emits, never listens to UI)
  /data             # ALL game content. JSON. Zod-validated.
    chassis/  weapons/  equipment/  pilots/  missions/  maps/  factions/
  /schema           # Zod schemas mirroring /data
  /render           # PixiJS. Reads sim state, never mutates it.
  /ui               # React. Mechbay, briefing, HUD overlays, campaign map.
  /campaign         # Meta-layer: economy, salvage, roster, time, save/load
  /headless         # CLI battle harness for balance analysis
```

### Non-negotiable rules

- `/sim` **must never** import from `/render`, `/ui`, or `/campaign`. Enforce with an ESLint `no-restricted-imports` rule.
- **All randomness** flows through `ctx.rng`. `Math.random()` is banned in `/sim` (ESLint rule).
- **Fixed timestep: 20Hz.** Render interpolates between sim states at display refresh rate.
- **No game stats in code.** If a number describes a weapon, a chassis, or a pilot, it lives in `/data` and is validated by a schema.
- Files stay under ~400 lines. Split before that.

This separation is what makes the headless balance harness possible. Protect it.

---

## 3. Core Simulation Model

### 3.1 Mech anatomy

Eight damage locations, BattleTech-standard:

`head, centre_torso, left_torso, right_torso, left_arm, right_arm, left_leg, right_leg`

Each location has **armour** (outer, absorbs first) and **internal structure** (inner).

The three torsos also have a **rear plate**, thinner than the glacis, which is
what fire from the rear arc meets. A design still authors one armour number per
location — the construction rules split it, so the bay keeps a single armour
control and tonnage arithmetic is unchanged. Arms, legs and the head have no
back: a leg is a leg from any angle, and giving them one would double the
paper-doll for no tactical gain. Side fire meets the front plate, since the side
arc is already paid for by its own damage factor and hit table.

Destruction consequences:

| Location destroyed | Effect |
|---|---|
| Head | Pilot killed or ejects. Mech disabled. |
| Centre torso | Mech destroyed (reactor breach). |
| Side torso | Weapons in it destroyed; carried ammo detonates unless CASE fitted. |
| Arm | Weapons in it destroyed. |
| One leg | Speed reduced 50%, and a lurch that may put the mech on the ground. |
| Both legs | Immobilised. Can still fire. **Prime salvage state.** |

**Stability.** A pool of shove that builds from heavy single hits and bleeds
away on its own. Only impacts over a floor contribute, so knockdown belongs to
big guns rather than to volume — a twenty-tube missile volley never rocks
anything, one autocannon shell does. A weapon's `recoil` separates guns that
land the same damage: a gauss slug and a large laser can burn the same plate off
a hull, but only one moves the mech behind it. Tonnage and the pilot's hands
divide the shove, so an assault takes twice the punishment a medium does.

Crossing the first threshold **staggers** — slower, less accurate, and visibly
in trouble. Crossing the second *while already staggered* puts the mech
**down**: four seconds unable to move, turn, twist or fire, and much easier to
hit. The pool is capped at the knockdown threshold, so nothing ever goes from
steady to floored in one shot; being knocked down is always something the player
saw coming. Standing clears the pool and buys a few seconds of solid footing, or
a mech under sustained heavy fire would never get up again.

**Frames.** Not everything on the field walks. A chassis declares a `frame` —
`mech`, `vehicle` or `turret` — and `/data/rules/frames.json` says what being one
changes: whether it moves at all, whether it can be shoved off its feet, how far
its guns come round off the nose, and which hit table its plating uses.

The mech frame is defined by absence. Its arc entry is `null`, meaning "the arcs
already in combat.json", and its twist is a factor of `1` on the one twist limit
in movement.json. A weighted draw walks its table in order, so a frame that
restated the mech weights could move every hit location in every battle in the
game; expressing the other frames as additions rather than as a replacement set
is what makes the file provably unable to do that.

All eight locations are kept for every frame, and the hit tables decide what
exists. A vehicle has no arms — weight zero, so the location is never drawn —
and its legs are its running gear, which means shooting the tracks off a carrier
immobilises it through exactly the both-legs rule above. An emplacement has
neither: everything goes into the hull and the cupola, and its thin plate is at
the back, where the ammunition hoist lives. Flanking one is the answer to it.

Immobility is one question with two causes. An emplacement was bolted down to
begin with; a mech with both legs gone has arrived at the same place by a worse
route. Pace, pathing, jets and being shoved aside all ask the same predicate, so
a turret never solves a route it cannot walk and a lance cannot shoulder one out
of the way.

Vehicles and emplacements are opposition, not roster. They are filtered out of
the bay, the yard and the dropship manifest, and a wrecked one yields its guns
but never its hull — there is no berth for something that does not walk.

### 3.2 Chassis schema

```json
{
  "id": "sentinel_snl2",
  "name": "Sentinel SNL-2",
  "class": "medium",
  "tonnage": 45,
  "baseCost": 3400000,
  "engineRating": 270,
  "internalHeatSinks": 10,
  "jumpCapable": false,
  "hardpoints": {
    "head":         { "energy": 0, "ballistic": 0, "missile": 0, "slots": 1 },
    "centre_torso": { "energy": 1, "ballistic": 0, "missile": 0, "slots": 2 },
    "left_torso":   { "energy": 0, "ballistic": 0, "missile": 2, "slots": 6 },
    "right_torso":  { "energy": 0, "ballistic": 1, "missile": 0, "slots": 6 },
    "left_arm":     { "energy": 2, "ballistic": 0, "missile": 0, "slots": 4 },
    "right_arm":    { "energy": 0, "ballistic": 1, "missile": 0, "slots": 4 },
    "left_leg":     { "energy": 0, "ballistic": 0, "missile": 0, "slots": 2 },
    "right_leg":    { "energy": 0, "ballistic": 0, "missile": 0, "slots": 2 }
  },
  "armourMax":  { "head": 18, "centre_torso": 70, "left_torso": 52, "right_torso": 52,
                  "left_arm": 38, "right_arm": 38, "left_leg": 46, "right_leg": 46 },
  "internals":  { "head": 6,  "centre_torso": 35, "left_torso": 22, "right_torso": 22,
                  "left_arm": 15, "right_arm": 15, "left_leg": 22, "right_leg": 22 },
  "traits": []
}
```

**Free tonnage** = `tonnage − engineWeight − structureWeight − armourWeight − heatSinkWeight`. Everything else is payload. This is the puzzle.

`engineWeight` and `structureWeight` derive from lookup tables in `/data/rules/`.

### 3.3 Movement

```
walkSpeed (m/s) = (engineRating / tonnage) * 3.0
runSpeed         = walkSpeed * 1.5
```

A 35t light with a 210 engine walks ~18 m/s (~65 kph). A 100t assault with a 300 engine walks ~9 m/s (~32 kph). Terrain multiplies: road ×1.2, open ×1.0, rough ×0.7, forest ×0.6, water ×0.5, impassable blocked.

Turn rate is inversely proportional to tonnage. Assaults are slow to bring guns to bear — this is a real tactical property, not flavour.

Jump jets: 1 ton each, grants a jump of `30m × jetCount`, ignores terrain, generates 3 heat per jet, has a cooldown.

**Orders the player can see land.** Every order reports itself. A click with nothing selected says so, a route that cannot be found says so, and an order abandoned mid-walk says so — an order that silently evaporates is indistinguishable from a control that does not work, and that ambiguity costs more than the noise. Selection commits on the press, never on the release, so a click that wobbles a few pixels — a human hand, or a stalled frame delivering a burst of pointer moves at once — is still a click; a box dragged from one of the player's own machines that catches nothing leaves that machine selected. The marquee is judged in screen pixels against each hull's on-screen body, because that is the rectangle the player drew: measuring it on the ground selected a different set, the camera being tilted enough that a mech's feet sit well behind its chest.

**Following orders.** A move order always resolves to ground the route can actually reach: a click on water, a cliff face or the far side of a wall retargets to the nearest bank the pathfinder can touch, and a click nothing can even approach reports "No route to that point" instead of silently doing nothing. A mech shoved past a waypoint by its lance-mates skips ahead rather than doubling back. A mech that stalls out within a couple of body-widths of its destination treats the order as complete — the spot is occupied by another machine, and looping walk-shove-stall against a lance-mate is what "my mech is stuck" means. Three stalled re-solves anywhere means the route is hopeless and the order stands down. An attack order on something out of range or out of sight is also an order to close: the mech walks toward its target until it is inside most of its longest gun's reach with a line of sight, then stops and fights from there.

### 3.4 Weapons

```json
{
  "id": "ac20",
  "name": "AC/20",
  "type": "ballistic",
  "tonnage": 14,
  "slots": 10,
  "damage": 20,
  "projectiles": 1,
  "heat": 7,
  "cooldown": 4.0,
  "velocity": 400,
  "range": { "min": 0, "short": 90, "medium": 180, "long": 270 },
  "ammoPerTon": 5,
  "cost": 300000,
  "recoil": 0.35
}
```

Required weapon families for launch content:

- **Energy** — Small / Medium / Large Laser; ER variants; Pulse variants (higher accuracy, higher heat); PPC; ER PPC; Flamer. No ammo, high heat.
- **Ballistic** — Machine Gun; AC/2, AC/5, AC/10, AC/20; LB-X Autocannon (spread, anti-armour); Gauss Rifle (huge damage, low heat, explodes when destroyed). Ammo-dependent, low heat.
- **Missile** — SRM 2/4/6 (short, high damage, spreads); LRM 5/10/15/20 (indirect fire with spotter, minimum range); Streak SRM (no miss, higher cost); MRM.
- **Equipment** — Heat Sink, Double Heat Sink, Jump Jet, ECM Suite, Active Probe, TAG, NARC, AMS, CASE, Targeting Computer.

Design intent: **no strictly dominant weapon.** The Gauss Rifle is superb but heavy, expensive, and volatile. The AC/20 hits like a truck at knife range only. Large Lasers are ammo-free but will cook you. Force trade-offs.

### 3.5 To-hit resolution

Rolled per weapon, per shot, through `ctx.rng`:

```
p_hit = clamp(
    gunneryBase(pilot.gunnery)      // skill 1→0.52 ... skill 5→0.86
  * rangeFactor(dist, weapon)       // short 1.0, medium 0.82, long 0.58, beyond 0.12
  * shooterMotion                   // stationary 1.0, walk 0.88, run 0.72, jumping 0.6
  * targetMotion                    // stationary 1.0, walk 0.9, run 0.7, jumping 0.62
  * coverFactor(tile)               // open 1.0, forest 0.8, building 0.7, hull-down 0.62
  * heightFactor(shooter, target)   // 1.08 per level of advantage, capped at two
  * proneFactor(target)             // target knocked down 1.5
  * staggerFactor(shooter)          // shooter fighting to stay upright 0.85
  * sensorFactor                    // ECM on target 0.85; TAG/NARC on target 1.15
  * weaponAccuracy                  // pulse 1.15, LB-X 1.1, standard 1.0
  , 0.05, 0.95)
```

Height only counts downhill and only to the cap: on a map with four levels of
relief, an uncapped bonus turns the ridge into a firing range rather than a
position worth taking.

**The readout.** Every one of these prices is shown before the shot, not
discovered after it. The weapon rows in the HUD carry the exact `p_hit` the
resolver will roll — the same function, never a parallel approximation that can
drift — for the selected mech's target, or for whatever hull the cursor is
over. Chips above them name the situational factors that are biting, and only
those. A gun that cannot fire says why instead of a number: dry, off arc, no
sight, too far. A system the player cannot see the price of is not a system
they are making decisions with; this is where the terrain, motion and arc
rules stop being flavour.

**Hit location** on success — weighted table:

```
centre_torso 20% | left_torso 13% | right_torso 13% | left_arm 14% | right_arm 14%
left_leg 12% | right_leg 12% | head 2%
```

**Called shots.** The player may designate a target location. Applies `×0.55` to `p_hit`, but on a hit gives a 70% chance to strike the designated location. Sharpshooter pilots improve both figures. This is the mechanism that makes legging a deliberate choice.

### 3.6 Heat

```
heatDelta_perTick = weaponHeatGenerated − (heatSinkCount × dissipationRate × terrainModifier)
```

Water submersion doubles dissipation. Standing in a fire or being flamed adds heat.

| Heat % | Effect |
|---|---|
| 50% | −10% movement speed |
| 70% | −15% accuracy |
| 85% | Shutdown risk per tick (piloting check to override) |
| 100% | Forced shutdown, 8s vulnerable; ammo explosion risk rises |

Heat is the primary balancing force against energy weapon stacking. Tune carefully in the headless harness.

---

## 4. Salvage — the Economic Spine

Salvage quality depends on **how** the enemy mech was neutralised. This is pillar 2 and the mechanic that most distinguishes this game.

| Kill method | Chassis recovery chance | Condition |
|---|---|---|
| Centre torso destroyed | 20% | Severe — expensive rebuild |
| Head destroyed | 45% | Chassis intact, cockpit destroyed |
| Both legs destroyed, then surrendered | 85% | Excellent — legs need replacing |
| Pilot ejected (heat/morale) | 90% | Best case |
| Ammo explosion | 5% | Usually scrap |

Weapons on surviving locations are recovered independently at 60–90%. A mech you leg cleanly might yield the chassis *and* its intact Gauss Rifle — worth more than the mission payout.

**Contract salvage rights** (0–100%) determine what share of recovered material you keep. Negotiating high salvage against low payout is a strategic choice at contract acceptance.

Repair costs C-bills **and days**. A cored chassis might sit in the bay for three weeks. Attrition is the difficulty curve.


**Choosing what comes home.** The crews cut loose more than the dropship will carry: a win offers up to five recovered items and the hold takes two. The debrief is where that decision is made, which is the difference between a screen the player skims and a screen they think about.

---

## 5. Resource Points (in-mission economy)

MechCommander 2's signature system. Retain it.

**Earning RP:** capturing comm towers, holding objective zones, destroying priority targets, mission time bonuses.

**Spending RP mid-mission.** The palette offered to the player is deliberately short — one eye, one hammer, one wrench:

| Support call | Cost | Effect |
|---|---|---|
| Sensor Probe | 200 | Reveals a map region for 30s |
| Air Strike | 700 | Fast linear strafe, high damage; drag to lay the run-in |
| Repair Truck | 500 | Deploys; repairs armour in an area over time |

Artillery, minelayer and reinforcement still exist in the rules and resolve fine — missions and future content can use them — but they are off the player's palette until the game earns the extra buttons. Missions currently start with 1000 RP while the system is under test.

This creates a live mid-mission economy: push for an optional objective to fund the airstrike that wins the fight.

---

### 5.1 Heat is the decision, not the bookkeeping

Weapons carry cooldowns, but a cooldown is automatic — it fires when it is ready and asks nothing of the player. Heat is the limiter that creates a choice, because it is shared across the machine and cumulative: alpha now and risk cooking, or pace the fire and stay mobile. It is also what makes the bay a puzzle rather than a shopping list, since sinks, guns and armour compete for the same tonnage.

So heat stays, and the parts of it that were invisible are the parts that go:

- **Stay Cool** (T) is a visible stance, not a silent governor. Off means weapons free and the shutdown is the player's to risk.
- **Alpha Strike** (X) drops the heat-capacity gate for a moment: every gun that bears fires at once, and the reactor's opinion becomes a problem for the next few seconds. It has its own cooldown, and it un-holds the guns so the volley actually leaves.
- A mech running hot **steams on the battlefield**, so "that one is about to shut down" is read from the fight rather than from a bar.

### 5.2 What a pilot can do

Every pilot carries one active ability on a cooldown, chosen by the specialities they hold — Aimed Volley, Evasive Burn, Sensor Sweep, Coolant Flush, Brace, or Steady Aim for a pilot with nothing relevant. Traits already made pilots differ, but only as numbers quietly multiplying other numbers; an ability is the same difference expressed as a button, so the roster screen and the battlefield finally talk about the same person. Fired with **V**, resolved in the simulation, and deterministic under replay.

## 6. Pilots

**Skills** (1–5 each): Gunnery, Piloting, Sensors.

XP awarded for damage dealt, kills, objectives captured, and mission survival. Skill increases cost escalating XP.

**Traits** unlock at skill thresholds. Examples:

- *Sharpshooter* — called shot penalty reduced to ×0.72
- *Coolant Discipline* — heat generation −15%
- *Evasive* — target motion factor improved when running
- *Multi-Trac* — fire at two targets simultaneously without penalty
- *Juggernaut* — melee and death-from-above damage +50%
- *Scout* — sensor range +40%, spotting for indirect LRM fire

**Injury and death.** Cockpit hits and mech destruction risk pilot injury (out for N days) or death. Optional ironman toggle at campaign start. Losing a 4/4/3 veteran on mission nine should hurt.

---

## 7. Campaign Layer

Node-based operational map. Missions unlock in a branching sequence; some optional nodes offer salvage-rich low-payout contracts, others the reverse.

**Between missions:**

- Mechbay — repair, refit, strip salvage
- Market — buy/sell chassis, weapons, ammo
- Barracks — hire pilots, assign, spend XP
- Contracts — accept, negotiate payout vs salvage split
- Time advances; repairs complete; contract deadlines expire

**Enemy scaling** by campaign progress and player lance weight, drawn from faction-specific composition tables. Enemies get *better pilots and better designs*, never invisible stat bonuses.

**Mission types:** Assault, Defend, Recon, Escort, Extraction, Base Capture, Ambush, Convoy Interdiction, Headhunt.

---

### 7.1 The loop

One full turn of the campaign reads: **map → mechbay → deployment → battle → salvage → map.** Signing a contract and pressing "Prepare drop" walks a two-stage corridor — the hangar first (repairs, rebuilds, refits), then the dropship manifest (who flies what, against the tonnage allowance) — and launching fights the battle. The debrief brings home salvage, pay and experience, and the map opens the next contract. The drop itself is sized by **tonnage, not berth count**: up to six machines may drop so long as they fit the allowance, so three heavies instead of four mediums is a legitimate answer to it, and a skirmish berth can simply be left empty.

## 8. Enemy AI

Utility-scoring, not scripted. Each enemy unit evaluates candidate actions each decision tick (~2Hz):

```
targetScore = (expectedDamagePerSecond × targetVulnerability × threatWeight)
              / (distancePenalty × exposurePenalty)
```

**Behaviours required:**

- Range-bracket seeking — a brawler closes, a sniper backs off
- Cover use and hull-down positioning
- Lance-level focus fire on a single damaged target
- Flanking when the player is engaged frontally
- Heat discipline — will hold fire rather than shut down
- Withdrawal when structurally critical (creates salvage opportunities)

**Difficulty tiers** adjust pilot skill values, lance composition, and aggression coefficient. Never HP or damage multipliers.

---

## 9. Headless Balance Harness

This is a first-class feature, not a dev afterthought.

```bash
npm run sim -- --mission=m07 --lance=./builds/heavy_brawl.json \
               --iterations=500 --seed=1337 --out=./reports/m07.json
```

Outputs: win rate, average mission duration, damage taken/dealt per mech, salvage yield distribution, pilot casualty rate, weapon-by-weapon damage efficiency (damage per ton, per heat, per C-bill).

Use this after every balance change. A weapon whose damage-per-ton-per-heat is 30% above its peers is a bug.

---

## 10. Rendering

**Phase 2 target: functional, not pretty.**

- Top-down orthographic, slight 2.5D via elevation shading
- Mechs as chassis-silhouette polygons, faction-coloured, with a facing indicator and a torso-twist indicator
- Weapons fire as tracers (ballistic), beams (energy), arcing sprites (missiles)
- Damage state shown by progressive silhouette darkening and component-loss visual changes
- Particle explosions, smoke plumes on damaged mechs
- Fog of war with sensor-range reveal and last-known-position ghosts

**HUD:**

- Per-mech paper-doll damage display (armour/internal per location)
- Heat bar with threshold markers
- Weapon group bindings (1–4) with cooldown rings
- Command palette: Move, Run, Jump, Attack, Called Shot, Hold Fire, Guard, Support Call
- Pause key freezes sim while allowing full order issuance — this is the "with pause" in real-time-with-pause and must feel instant

Art upgrade is Phase 7. Do not let it block earlier phases.

---

## 11. Build Phases

Each phase ends with a **verifiable acceptance test**. Do not begin a phase until the previous one passes.

### Phase 0 — Foundation

Repo scaffold, Vite + TS strict, ESLint with import-boundary and `no-Math.random` rules, Vitest, seeded RNG with a determinism test, Zod schemas for chassis/weapon/equipment, three sample chassis and eight sample weapons in `/data`.

**Accept:** `npm test` passes. Same seed produces identical RNG sequences across 10,000 draws. All `/data` files validate.

### Phase 1 — Headless Simulation Core

Mech entity and component state, terrain grid, A* pathfinding, locomotion, LOS and cover, weapon firing with cooldowns, to-hit and hit location, damage application and location destruction, heat model with shutdown, ammo tracking and explosion. Placeholder AI: advance and engage nearest.

**Accept:** `npm run sim -- --iterations=100` runs 100 complete 4v4 battles headlessly and prints a results table. Same seed, identical outcome, every time. No rendering code exists.

### Phase 2 — Tactical Renderer

PixiJS tilemap, mech rendering with facing, selection and move orders, attack orders, projectile and beam visuals, damage paper-doll, heat bar, pause, camera pan/zoom, fog of war.

**Accept:** A skirmish mission is playable end to end with mouse and keyboard. Pause instantly freezes the sim and accepts orders.

### Phase 3 — Mechbay

Loadout editor with drag-to-hardpoint, live validation of tonnage / slots / hardpoint type, armour allocation slider per location, heat efficiency calculator showing sustained vs alpha-strike heat, build save/load to JSON.

**Accept:** An invalid build cannot be saved. The heat calculator correctly predicts sim behaviour for three test builds (verify against headless runs).

### Phase 4 — Campaign Shell

Campaign map, mission select, contract negotiation (payout vs salvage), C-bill economy, salvage resolution after missions, pilot roster and XP, repair queue with day advancement, save/load.

**Accept:** A three-mission campaign can be completed, with salvage from mission one usable in mission three. Save and reload preserves exact state.

### Phase 5 — Objectives & Support

Mission scripting via trigger/event definitions in JSON, objective types, Resource Point earning and spending, all six support calls, mission success/failure conditions, briefing screen.

**Accept:** A base-capture mission with a mid-mission reinforcement trigger plays correctly. All support calls function.

### Phase 6 — AI Depth & Balance

Utility-scoring AI with all behaviours from §8, lance coordination, difficulty tiers, full weapon and chassis content pass, balance analysis via the headless harness.

**Accept:** Headless report shows no weapon outside ±20% of its class median on damage-per-ton-per-heat. AI wins ≥40% of mirror-match engagements against a competent human baseline lance.

### Phase 7 — Polish

Audio, improved particle work, upgraded mech art, UI refinement, tutorial mission, settings, keybinding.

**Optional stretch:** LLM-generated mission briefings, pilot radio chatter, and dynamic campaign events via a local API key. Keep this strictly optional and fully behind an interface — the game must play identically with it disabled.

---

## 12. CLAUDE.md — Agent Working Rules

Place this at repo root. See [`CLAUDE.md`](CLAUDE.md).

---

## 13. Intellectual Property Note

MechWarrior, BattleTech, and their chassis names, designs, and artwork are owned by Microsoft, Piranha Games, and Catalyst Game Labs. The *mechanics* described here — tonnage-constrained loadouts, hit locations, heat management — are game design ideas and not protectable. Specific names and visual designs are.

Use original chassis names and original silhouettes. "Sentinel SNL-2" rather than a Timber Wolf. This costs nothing and keeps the project shareable if you ever open-source it.

---

## 14. Getting Started

```bash
cd ironline
npm install
npm test
```

Proceed phase by phase. Resist the urge to let it run ahead — the acceptance tests are what keep a project this size from collapsing into unverifiable sprawl around Phase 4.
