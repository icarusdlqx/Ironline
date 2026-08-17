# Launch notes

Working notes for taking the game public. Kept in the repository so any
session — human or agent — can pick the list up where the last one stopped.

## The name

"Iron Line" is already a game on Steam (app 2707410, a tower-defence title),
so shipping under IRONLINE invites confusion and a store collision. Candidate
names checked against Steam and found clear as of August 2026: **Ironshod**,
**Warplate**, **Ferroline**. Before committing to one, give it a pass through
the USPTO trademark search (tmsearch.uspto.gov) and a plain web search for
games, bands, and companies.

Renaming is one commit plus one dashboard change. The checklist:

- `index.html` — `<title>` and the `apple-mobile-web-app-title` meta
- `public/manifest.webmanifest` — `name` and `short_name`
- `package.json` — `name`
- `README.md` and `IRONLINE_DESIGN.md` — headings and prose
- `npm run build:single` output name if it should match
- Cloudflare dashboard — rename the project (the `*.workers.dev` /
  `*.pages.dev` URL follows it), or attach a custom domain
- GitHub repository name, if desired (old URLs redirect)
- Leave the `ironline.*` localStorage keys alone: they are invisible to
  players and renaming them silently discards every existing save and
  settings choice.

## The IP scrub (done, August 2026)

An audit found the weapon and equipment catalogue reproduced another mech
franchise's designations near-verbatim, plus a handful of name collisions.
All player-facing names were replaced with originals; the JSON `id` keys were
deliberately left alone so existing saves keep working (ids never render and
are not used as marks in commerce). The renames:

- Frame label "BattleMech" (a live trademark) → "Mech"
- Weapon designations → original names (AC/n → Light/Field/Heavy/Siege
  Autocannon, LB-X → Canister Cannon, PPC → Arc Projector, ER → Focused,
  Pulse → Burst, SRM → Shortbow, LRM → Longshot, MRM → Volley,
  Streak → Seeker, Inferno → Scorcher, Thunderbolt → Longspear,
  Light/Heavy Gauss → Gauss Carbine/Howitzer, Heavy Large Laser → Smelter
  Laser)
- Equipment: CASE → Blowout Cell, NARC → Limpet Beacon, TAG → Target
  Designator, Double Heat Sink → Compound Heat Sink, Active Probe → Deep
  Scanner
- Chassis: Wisp WSP-1 → Vesper VES-1 (was one letter from a famous mech,
  same model prefix), Hornet HNT-2 → Gadfly GAD-2 (identical name to one)
- Factions/lore: Steel Legion → Slag Legion, Wolfhound Detachment →
  Watchdog Detachment, the Warden Compact → the Harrow Compact, Kell Reach
  → Karst Reach, "C-bills" → "credits"
- Docs no longer name the franchises they were inspired by

Kept as generic vocabulary (real words, real military/engineering terms, or
genre-generic): mech, lance, dropship, autocannon, gauss rifle, heat sink,
jump jet, alpha strike, called shot, flamer, plasma rifle, machine gun, the
eight hit locations.

Residual, deliberately accepted: internal ids (`lrm15`, `ppc`, `case`…)
still mirror the old designations — invisible to players, but if the repo's
public history ever feels like exposure, migrate them with a save-format
bump. Several items still share tonnage/slot numbers with their inspirations;
mechanics and stats are not protectable, and ongoing balance passes will
diverge them naturally.

## Analytics

Cloudflare Web Analytics is free, cookie-less, and needs no consent banner:
Cloudflare dashboard → Analytics & Logs → Web Analytics → add the site, then
paste the beacon `<script>` it gives you into `index.html` just before
`</head>`. That single tag reports visits, referrers, and Core Web Vitals.
This needs the dashboard token, so it is a human step, not an agent one.

## itch.io

`npm run build:single` produces `dist-single/` with one self-contained HTML
file — no assets to zip, nothing to break. On itch: create the project, set
"Kind of project" to HTML, upload the file, tick "This file will be played in
the browser", enable fullscreen, and set the viewport to at least 1280×800.
The in-game Feedback link already points at the GitHub issue tracker, so
players from any storefront land in the same place.

## Difficulty for strangers

First launches now start on Green (the picker in the top bar still offers
the full ladder). Nobody who bounced off their first battle plays a second.

## Remaining before a public push

- [ ] Pick the name, run the rename checklist above
- [ ] Add the analytics beacon (human step, needs the dashboard)
- [ ] One full playthrough at Green from a cleared browser profile
- [ ] itch.io page with screenshots and a short pitch
