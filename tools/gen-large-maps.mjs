/**
 * Bakes the two large battlefields into src/data/maps.
 *
 * The layouts are deterministic by construction. The assertions are part of
 * the authoring contract: a formula change must explain its terrain budget
 * instead of quietly shipping a different battlefield.
 *
 *   node tools/gen-large-maps.mjs
 */
import { writeFileSync } from 'node:fs';

const SIZE = 56;
const LEGEND = {
  '.': 'open',
  r: 'rough',
  f: 'forest',
  w: 'water',
  '=': 'road',
  b: 'building',
  x: 'impassable',
};

function hash(x, y, salt) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function grid(fill) {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => fill));
}

function fillRect(cells, fromX, fromY, toX, toY, value) {
  for (let y = fromY; y <= toY; y += 1) {
    for (let x = fromX; x <= toX; x += 1) cells[y][x] = value;
  }
}

function paintRoad(cells, x, y) {
  for (let offsetY = 0; offsetY < 2; offsetY += 1) {
    for (let offsetX = 0; offsetX < 2; offsetX += 1) {
      const column = x + offsetX;
      const row = y + offsetY;
      if (column >= 0 && column < SIZE && row >= 0 && row < SIZE) cells[row][column] = '=';
    }
  }
}

function paintPolyline(cells, points) {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    const [endX, endY] = end;
    let [x, y] = start;
    const stepX = Math.sign(endX - x);
    const stepY = Math.sign(endY - y);

    // The next segment owns the shared vertex. This keeps the two-tile brush
    // continuous without painting a corner twice under different directions.
    while (x !== endX || y !== endY) {
      paintRoad(cells, x, y);
      x += stepX;
      y += stepY;
    }
  }
}

function counts(rows) {
  const result = {};
  for (const symbol of rows.flat()) result[symbol] = (result[symbol] ?? 0) + 1;
  return result;
}

function assertCounts(id, cells, expected) {
  const actual = counts(cells);
  for (const [symbol, count] of Object.entries(expected)) {
    if (actual[symbol] !== count) {
      throw new Error(`${id}: expected ${count} "${symbol}" tiles, got ${actual[symbol] ?? 0}`);
    }
  }
  if (Object.values(actual).reduce((sum, count) => sum + count, 0) !== SIZE * SIZE) {
    throw new Error(`${id}: incomplete ${SIZE}x${SIZE} tile grid`);
  }
}

function bake(id, name, atmosphereId, propTheme, tiles, elevation, expected) {
  assertCounts(id, tiles, expected);
  const map = {
    id,
    name,
    tileSize: 24,
    width: SIZE,
    height: SIZE,
    atmosphereId,
    propTheme,
    legend: LEGEND,
    tiles: tiles.map((row) => row.join('')),
    elevation: elevation.map((row) => row.join('')),
  };
  const target = new URL(`../src/data/maps/${id}.json`, import.meta.url);
  writeFileSync(target, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`baked ${id}`);
}

// ---------------------------------------------------------- Cutbank Exchange
{
  const tiles = grid('.');
  const elevation = grid(0);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (hash(x, y, 17) < 0.12) tiles[y][x] = 'r';
    }
  }

  for (const row of [19, 20, 35, 36]) fillRect(tiles, 0, row, SIZE - 1, row, 'w');
  for (const [fromX, fromY, toX, toY] of [
    [4, 4, 8, 11], [18, 3, 25, 10], [31, 4, 37, 11], [47, 4, 52, 12],
    [3, 24, 8, 31], [47, 24, 52, 31], [3, 43, 9, 50], [19, 45, 26, 52],
    [32, 44, 38, 51], [47, 43, 52, 51],
  ]) fillRect(tiles, fromX, fromY, toX, toY, 'b');

  for (const [fromX, fromY, toX, toY] of [
    [0, 47, 8, 55], [47, 0, 55, 8], [53, 24, 55, 32],
  ]) fillRect(tiles, fromX, fromY, toX, toY, '.');

  for (const row of [8, 9, 27, 28, 46, 47]) fillRect(tiles, 0, row, SIZE - 1, row, '=');
  for (const column of [10, 11, 40, 41]) fillRect(tiles, column, 0, column, SIZE - 1, '=');
  for (let y = 0; y < SIZE; y += 1) {
    const x = 52 - y;
    for (const column of [x, x + 1]) {
      if (column < 0 || column >= SIZE) continue;
      tiles[y][column] = '=';
      elevation[y][column] = 1;
    }
  }
  for (const row of [27, 28]) fillRect(elevation, 0, row, SIZE - 1, row, 1);

  bake(
    'cutbank_exchange',
    'Cutbank Exchange',
    'industrial_smog',
    'industrial',
    tiles,
    elevation,
    { '.': 1749, '=': 623, r: 203, b: 361, w: 200 },
  );
}

// --------------------------------------------------------- Blackglass Quarry
{
  const tiles = grid('.');
  const elevation = grid(0);
  const seams = new Set([4, 9, 15, 21, 26]);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inset = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      elevation[y][x] = inset < 5 ? 5 : inset < 10 ? 4 : inset < 16 ? 3 : inset < 22 ? 2 : inset < 27 ? 1 : 0;
      if (seams.has(inset)) tiles[y][x] = hash(x, y, 31) < 0.18 ? 'x' : 'r';
      else if (inset < 10 && hash(x, y, 41) < 0.055) tiles[y][x] = 'f';
      else if (hash(x, y, 43) < 0.08) tiles[y][x] = 'r';
    }
  }

  for (const bounds of [[22, 29, 25, 32], [31, 23, 34, 26]]) {
    fillRect(tiles, ...bounds, 'w');
  }
  for (const bounds of [
    [4, 20, 7, 24], [19, 4, 23, 7], [48, 30, 51, 34], [32, 48, 36, 51],
  ]) fillRect(tiles, ...bounds, 'b');

  paintPolyline(tiles, [
    [3, 52], [18, 52], [18, 42], [10, 42], [10, 34], [25, 34], [25, 28], [28, 28],
  ]);
  paintPolyline(tiles, [
    [52, 3], [38, 3], [38, 13], [46, 13], [46, 22], [31, 22], [31, 27], [28, 27],
  ]);

  bake(
    'blackglass_quarry',
    'Blackglass Quarry',
    'dust_storm',
    'shale',
    tiles,
    elevation,
    { '.': 2081, f: 73, r: 557, '=': 262, x: 65, b: 80, w: 18 },
  );
}
