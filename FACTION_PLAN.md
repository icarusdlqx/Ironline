# The faction rebuild

A staged plan to give the game two distinct machine cultures, a weapon
catalogue half its current size and twice its character, a campaign that earns
the salvage loop, and a mechbay a newcomer can read. Work the phases in order:
each one depends on the one before it, and each ends at a gate.

**Not in scope.** The game keeps the name IRONLINE for now — no renaming of the
title, the repo, the package, the manifest, or the `ironline.*` localStorage
keys. Revisit once the game is further along.

## The one rule that changed

`CODEX_BRIEF.md` still holds: **do not edit `src/sim/**`.** Nothing in this
plan requires it — factions live in data, campaign economics live in
`src/campaign`, and the visual identity lives in the render layer.

What *has* changed: this plan edits weapon and chassis statistics, which are
**sim-affecting data**. So the balance gate is now yours to run:

```
npx vitest run src/sim/balance.test.ts        # ~13 minutes, 200 mirror matches
npx vitest run src/campaign/acceptance.test.ts
```

Run both **after your last edit**, never alongside further editing. If you
change anything afterwards, run them again. A phase marked "balance gate" below
is not finished until both are green and you have said so in the pull request.

---

## The setting problem, and its solution

The existing lore says nobody on Tessell can design a mech, everyone rebuilds
the same Compact hulls, and "nothing here is called a war." Two rival mech
lines with distinct weapons appears to contradict all three. Read
`src/data/lore/*.json` before writing anything — that voice is the standard to
match, and it is dry, concrete and specific.

The reconciliation: **the factions are not two armies, they are two sources of
machines.** One is welded together by people who need it back next week. The
other has been sealed in the dark for ninety years. Everything else — the
weapons, the economics, the way they walk — follows from that.

| | Faction A | Faction B |
|---|---|---|
| Formal name | **Linewrought** | **Aurelian Stock** |
| Slang | *the welded*, *shopwork* | *the sealed*, *coldstock* |
| Weapons | Ballistic and missile | Energy |
| Ammunition | Eats it, runs dry, detonates | None at all |
| Heat | Low | High capacity, but sustained fire cooks it |
| Armour per ton | Lower | Higher |
| Repair | Days, cheap, parts always stocked | Weeks, expensive, parts unbuyable |
| Look | Welded seams, rivets, exposed feed chutes, rust and hazard yellow | Smooth sealed shells, symmetric, no visible mechanism, bone-white and verdigris |

### Linewrought

The depots gave up hulls, not machines: frames on their sides in the dark,
spares crated under a numbering system nobody kept the key to. So the shops on
the grade learned the only trade Tessell has — cut out what has seized,
re-armour in Sarn plate, hang whatever guns the smelter towns can still turn
out, and stamp it with a mark number that counts trips through the shop rather
than anything a designer intended. A Linewrought machine is a record of its own
repairs, and two of them on the same chassis are nothing alike. You can make a
tube and a shell with what this continent has. You cannot make a sealed
capacitor, which is why everything the shops build eats ammunition, and why
every pilot on the Line has run dry at least once.

### Aurelian Stock

The Compact came to strip Tessell and intended to leave nobody behind, so they
built machines that need no technicians: sealed reactors, no ammunition, no
access panels, designed to be returned to a facility that no longer exists.
When the charter lapsed they were gone inside a year, and what they did not
ship out they sealed where it stood. Ninety years later nobody has opened one
and had it work afterwards. They do not run dry and they do not burn out. But
when a Sealed machine breaks it stays broken, and the only source of a
replacement part is another Sealed machine.

---

## Phase 1 — The faction data model

**Files:** `src/schema/chassis.ts`, `src/schema/weapon.ts`, every
`src/data/chassis/*.json`, every `src/data/weapons/*.json`,
`src/data/equipment/*.json`.

Add a required `faction` field, one of `linewrought` | `aurelian`, to chassis,
weapons and equipment. Assign every existing entry. Nothing else changes — no
statistics move in this phase, so it stays cheap to review and cheap to revert.

Assign by what the thing is, not by who is holding it: autocannons, missile
racks, gauss weapons and machine guns are Linewrought; lasers and particle
weapons are Aurelian. Flamers are Linewrought (fuel, not capacitors).

**Gate:** fast suite. No balance gate — no statistics changed.

## Phase 2 — Halve the weapon catalogue

**Files:** `src/data/weapons/*.json`, plus any test fixture that names a weapon
that goes away.

There are **41 weapons**. That is the real reason the mechbay is unreadable, and
no amount of UI work fixes it. **Target: 24, split 12 Linewrought and 12
Aurelian.** Cutting is the work; keep the ones with the most character.

### Redundancies to remove

- **The Focused/standard laser pairs** (`medium_laser` vs `er_medium_laser`, and
  the small and large equivalents) differ *only in price* — identical
  damage-per-heat, same tonnage, same slots, same cooldown, 2x the cost. That is
  not a trade-off in an economy where cash accumulates. Keep one of each pair,
  or give the survivor a real drawback.
- **Volley 30** sits between 20 and 40 and adds nothing. Cut.
- **Seeker 2/4/6** — keep one.
- **Shortbow 2/4/6** — keep two.
- **Longshot 5/10/15/20** — keep two.

### Balance faults to fix (measured, not guessed)

- **Longspear 15 is the strongest weapon in the game.** 11 t, **46 damage into a
  single location** at 510 m, 0.22 crit, 260k. The Gauss Rifle is 15 t for 21
  damage at 390 m and costs **600k**. Double the damage, four tons lighter, 120 m
  further, under half the price. Bring it into line or cut it.
- **Volley 40** has the highest DPS in the game (19.4) and 68-point bursts at 5.7
  damage-per-heat. Spread, 240 m range and 0.85 accuracy partly excuse it; it is
  still the best heavy sustained damage per ton.
- **The burst (pulse) laser family is dead weight.** Medium Burst costs double
  the tonnage of a Medium Laser for +10% damage, -25% range and worse heat
  efficiency (0.8 vs 1.0), buying only +30% accuracy. Nobody should take that.
  Fix the trade or cut the family to one entry.
- **The energy/ballistic gap is 8x on DPS-per-ton** (Focused Medium 2.8, Gauss
  Rifle 0.35). Heat-versus-ammo is the intended axis, but at this magnitude
  boating small energy weapons is optimal whenever heat allows, which quietly
  makes heat the only decision in the game. Narrow it.
- **Shortbow 2** at 1 t returns 3.1 damage-per-heat and 2.07 DPS-per-ton — the
  most efficient missile in the game and a likely light-mech exploit.

Regenerate the measurements yourself before and after; do not trust the numbers
above to still hold once you start moving things:

```
python3 - <<'EOF'
import json, glob
for f in sorted(glob.glob('src/data/weapons/*.json')):
    d=json.load(open(f)); r=d.get('range',{})
    dmg=d.get('damage',0)*d.get('projectiles',1); cd=d.get('cooldown',1) or 1
    print(f"{d['name']:24} {d['tonnage']:>5}t dps={dmg/cd:6.2f} dps/ton={dmg/cd/d['tonnage']:5.2f} "
          f"dmg/heat={dmg/max(d.get('heat',0.001),0.001):6.1f} rng={r.get('long') or r.get('max')}")
EOF
```

### Naming

Keep the generic English names — **Medium Laser, Large Laser, Machine Gun,
Autocannon, Gauss Rifle, Flamer** are descriptive terms and are staying. Give
new or reworked entries names with faction voice; never reuse another mech
franchise's designations (no LRM, SRM, PPC, AC/20, ER, Pulse, Streak, LB-X).
`LAUNCH.md` records what was scrubbed and why — do not let any of it back in.

**Ids are load-bearing.** They appear in save files and campaign state. Removing
a weapon means existing saves referencing it must degrade gracefully rather than
crash — check `src/campaign/save.ts` and add a migration if needed.

**Gate:** balance gate + acceptance + fast suite + playthrough.

## Phase 3 — Sixteen machines, eight a side

**Files:** `src/data/chassis/*.json`, `src/data/designs/*.json`,
`src/render/blueprint/plans-*.ts`.

Thirteen chassis exist. Assign eight to Linewrought and five to Aurelian, then
author **three new Aurelian chassis** so each faction fields a full ladder:
two light, two medium, two heavy, two assault. Both sides must be playable as a
complete lance, and a mixed lance has to make sense.

Give each new chassis its own body plan under `src/render/blueprint/` — plans
are authored per machine rather than scaled from one shape, and the Sealed
machines are the chance to make that pay off: symmetric, closed, no visible
mechanism.

Hardpoints carry the faction identity. Aurelian chassis are mostly energy
hardpoints, Linewrought mostly ballistic and missile — which is what makes
bolting captured guns onto a captured hull *possible but awkward*. That is the
intended texture; do not smooth it out.

**Gate:** balance gate + acceptance + fast suite + playthrough.

## Phase 4 — Salvage economics and the campaign

**Files:** `src/campaign/repair.ts`, `src/campaign/refit.ts`,
`src/campaign/market.ts`, `src/data/campaigns/border_dispute.json`,
`src/data/missions/*.json`, `src/data/lore/*.json`.

The point of the split is a decision the player actually feels: **a captured
Sealed machine is better in the field and a liability in the bay.**

- Repair of an Aurelian mech costs 2-3x and takes 2-3x the days
- Aurelian parts are **not purchasable** in the market at any price
- The only source of Aurelian components is salvage from another Aurelian machine

So fielding captured kit commits you to hunting more of it for spares. That is a
strategic decision built from cost multipliers and one availability flag — **no
new systems.** Keep it that simple.

### The campaign, four acts

1. **Line maintenance.** Halloran contracts, Kestrel rivalry, ordinary disputes.
   Teaches the rules of the Line and how a lance works.
2. **Something walks that shouldn't.** Kestrel fields a machine nobody
   recognises. The player barely survives, and takes their first Sealed salvage.
3. **The rules break.** Kestrel stops honouring the Rules of the Line — shoots a
   seat, or cuts the conduit. It becomes a war nobody will call a war.
4. **The depot.** Reach it before Kestrel empties it. The ending is a choice:
   **burn it**, so nobody inherits the Compact's machines and the Line survives
   as it was, or **take it**, and become the power the next war is fought
   against.

Fold the two backstories above into `src/data/lore/` as new articles, in the
voice of the four that are already there.

**Gate:** acceptance + fast suite + playthrough.

## Phase 5 — How they walk

**Files:** `src/render3d/mechModel.ts`, the `src/render3d/scene*` modules, and
the audio set (`src/ui/audioVoices.ts`, `audioWeapons.ts`, `audioCues.ts`).

Two machine cultures should be tellable apart at a glance, from the movement
alone, before the player reads a single label.

**Welded** — a hitch in the stride, one leg fractionally out of phase.
Hydraulic slop on weight transfer. The whole frame recoils when it fires;
casings eject, the breech vents smoke. Startup is a cough and a shudder. Damage
tears panels loose to dangle. At idle it is never entirely still — small
constant corrections, a shifting of weight.

**Sealed** — an unnervingly even gait, no wasted vertical motion, feet placed
exactly. **The torso tracks its target instantly, with no lag at all** — that is
the tell, and it is already data-driven through the `twistLimit` and
`torsoOffset` fields the schema carries. No recoil: a rising hum, then
discharge. Startup is silent, lights coming up in sequence. Damage shows
nothing — it walks identically until the moment it doesn't, then drops all at
once. At idle it is *perfectly* still, which is what makes it frightening.

Where the difference can be expressed as chassis data rather than render code,
do it as data.

**Gate:** fast suite + playthrough, with before/after screenshots.

## Phase 6 — The mechbay

**Files:** `src/ui/mechbay/*.tsx` (Mechbay.tsx is 700 lines — split it),
`src/ui/styles.css`.

The bay shows numbers and expects the player to do arithmetic. Fix that.

- **A live 3D preview** built from the same `src/render/blueprint/` data the
  battlefield uses — rotating, mounted weapons visible on the hull, hardpoints
  highlighted on hover. The bay and the field finally agree about what a machine
  looks like. This is the single biggest upgrade on the board.
- **Procedural weapon glyphs** — a stubby drum for autocannons, a lens array for
  lasers, a honeycomb for missile racks. No asset pipeline; draw them.
- **The same three bars on every weapon card** — Damage, Reach, Heat — so
  comparison is visual instead of arithmetic. Plus one plain-English cost line:
  "4 tons, 2 slots, cooks you at 2.8 heat a second."
- **A range-band strip** showing this weapon against what is already mounted,
  answering "does this fit the way I fight?"
- **Filter to the hardpoint that was clicked**, so only what can actually go
  there is offered. This alone removes most of the overwhelm.
- **Category headers using plain English** — Long-Range Missiles, Short-Range
  Missiles, Autocannons, Lasers, Particle Weapons, Machine Guns — so a newcomer
  reads the shelf instantly while the individual items keep their faction names.
- **Faction tint on cards**, so captured kit reads at a glance.

**Gate:** fast suite + playthrough, with before/after screenshots.
