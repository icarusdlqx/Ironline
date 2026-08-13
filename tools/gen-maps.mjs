/**
 * Bakes the authored battlefield maps into src/data/maps.
 *
 * Maps are data, not code: this script exists so a 40x40 grid can be described
 * as structure — a river, a city block, a terrace — instead of being typed one
 * character at a time, and the result is committed as ordinary JSON that the
 * loader validates like anything else. Deterministic by construction: the same
 * script always writes the same maps.
 *
 *   node tools/gen-maps.mjs
 */
import { writeFileSync } from 'node:fs';

const SIZE = 40;

/** Local xorshift so the bake never depends on Math.random. */
function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

function grid(fill) {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => fill));
}

function bake(id, name, tiles, elevation) {
  const map = {
    id,
    name,
    tileSize: 24,
    width: SIZE,
    height: SIZE,
    legend: { '.': 'open', r: 'rough', f: 'forest', w: 'water', '=': 'road', b: 'building', x: 'impassable' },
    tiles: tiles.map((row) => row.join('')),
    elevation: elevation.map((row) => row.join('')),
  };
  writeFileSync(new URL(`../src/data/maps/${id}.json`, import.meta.url), JSON.stringify(map, null, 2) + '\n');
  console.log(`baked ${id}`);
}

// --------------------------------------------------------------- The Causeway
// A drowned valley: two dry banks joined by a raised road, with fords of
// rough shallows north and south. Whoever holds the causeway holds the map;
// whoever refuses it wades slow and cools their reactor doing it.
{
  const random = rng(0xca05e);
  const tiles = grid('.');
  const elevation = grid(0);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // The water body: a broad diagonal band across the middle.
      const band = x + y * 0.6;
      if (band > 26 && band < 40) tiles[y][x] = 'w';
      // Marsh edges: rough ground shouldering the water.
      else if (band > 23.5 && band <= 26) tiles[y][x] = random() < 0.7 ? 'r' : '.';
      else if (band >= 40 && band < 42.5) tiles[y][x] = random() < 0.7 ? 'r' : '.';
      // Dry banks get scattered copses.
      else if (random() < 0.08) tiles[y][x] = 'f';
    }
  }

  // The causeway: a straight road cut across the water, slightly raised.
  for (let y = 0; y < SIZE; y += 1) {
    const x = Math.round(20 + (y - 20) * -0.6);
    for (const cut of [x, x + 1]) {
      if (cut >= 0 && cut < SIZE) {
        tiles[y][cut] = '=';
        elevation[y][cut] = 1;
      }
    }
  }
  // Two fords: shallows a lance can wade, wide enough to flank through.
  for (const ford of [{ cx: 33, cy: 6 }, { cx: 8, cy: 34 }]) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = ford.cx + dx;
        const y = ford.cy + dy;
        if (x >= 0 && x < SIZE && y >= 0 && y < SIZE && tiles[y][x] === 'w') tiles[y][x] = 'r';
      }
    }
  }
  bake('causeway', 'The Causeway', tiles, elevation);
}

// ---------------------------------------------------------- Foundry District
// Sarn's outer works: city blocks and yard walls on a road grid. Sightlines
// are streets; every corner is an ambush. Long-range lances hate it here.
{
  const random = rng(0xf0d21);
  const tiles = grid('.');
  const elevation = grid(0);

  // Road grid every 8 tiles, both ways.
  for (let i = 0; i < SIZE; i += 1) {
    for (const line of [4, 12, 20, 28, 36]) {
      tiles[line][i] = '=';
      tiles[i][line] = '=';
    }
  }

  // Blocks: buildings with yards. Skip some blocks entirely for open plazas.
  for (let by = 0; by < 5; by += 1) {
    for (let bx = 0; bx < 5; bx += 1) {
      const open = random() < 0.22;
      for (let y = 5 + by * 8; y < 12 + by * 8 && y < SIZE; y += 1) {
        for (let x = 5 + bx * 8; x < 12 + bx * 8 && x < SIZE; x += 1) {
          if (tiles[y][x] === '=') continue;
          if (open) {
            if (random() < 0.14) tiles[y][x] = 'r';
            continue;
          }
          const inner =
            y > 5 + by * 8 && y < 11 + by * 8 && x > 5 + bx * 8 && x < 11 + bx * 8;
          if (inner && random() < 0.75) tiles[y][x] = 'b';
          else if (random() < 0.2) tiles[y][x] = 'r';
        }
      }
    }
  }

  // Keep the corners open as deployment ground.
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      tiles[y][x] = '.';
      tiles[SIZE - 1 - y][SIZE - 1 - x] = '.';
    }
  }
  bake('foundry_district', 'Foundry District', tiles, elevation);
}

// -------------------------------------------------------------- Shale Steps
// Highland terraces climbing from south-west to north-east: three broad
// steps of shale with a switchback road. Height is the weapon here — the
// upper terrace sees everything and the climbs are killing grounds.
{
  const random = rng(0x5a1e5);
  const tiles = grid('.');
  const elevation = grid(0);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const climb = (x + (SIZE - 1 - y)) / 2;
      const step = climb < 12 ? 0 : climb < 15 ? 1 : climb < 24 ? 2 : climb < 27 ? 3 : 4;
      // Steps 1 and 3 are the scarps between terraces: steep shale.
      if (step === 1 || step === 3) {
        tiles[y][x] = random() < 0.75 ? 'r' : '.';
        elevation[y][x] = step === 1 ? 1 : 3;
      } else {
        elevation[y][x] = step === 0 ? 0 : step === 2 ? 2 : 4;
        if (random() < 0.07) tiles[y][x] = 'f';
        else if (random() < 0.05) tiles[y][x] = 'r';
      }
      // A few crags that cannot be walked at all.
      if ((step === 1 || step === 3) && random() < 0.1) tiles[y][x] = 'x';
    }
  }

  // The switchback: a road that zigzags up the face.
  let x = 4;
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    const drift = y > 26 ? 1 : y > 13 ? -1 : 1;
    x = Math.max(1, Math.min(SIZE - 2, x + (y % 2 === 0 ? drift : drift > 0 ? 1 : 0)));
    tiles[y][x] = '=';
    tiles[y][Math.min(SIZE - 1, x + 1)] = '=';
  }
  // The road is graded: it takes the elevation of the ground beside it.
  for (let y = 0; y < SIZE; y += 1) {
    for (let cut = 0; cut < SIZE; cut += 1) {
      if (tiles[y][cut] !== '=') continue;
      const left = elevation[y][Math.max(0, cut - 2)];
      const right = elevation[y][Math.min(SIZE - 1, cut + 2)];
      elevation[y][cut] = Math.min(left, right);
    }
  }
  bake('shale_steps', 'Shale Steps', tiles, elevation);
}
