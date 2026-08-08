import { describe, expect, it } from 'vitest';
import { createRng, rngFromState, stateFromSeed, type RngSeed } from './rng';

const DETERMINISM_DRAWS = 10_000;

function floatSequence(seed: RngSeed, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

function fingerprint(seed: RngSeed, count: number): number {
  const rng = createRng(seed);
  let accumulator = 0;
  for (let index = 0; index < count; index += 1) {
    accumulator = (Math.imul(accumulator, 31) + rng.nextUint32()) >>> 0;
  }
  return accumulator;
}

describe('determinism', () => {
  it('produces an identical sequence of 10,000 draws from the same numeric seed', () => {
    expect(floatSequence(1337, DETERMINISM_DRAWS)).toEqual(floatSequence(1337, DETERMINISM_DRAWS));
  });

  it('produces an identical sequence of 10,000 draws from the same string seed', () => {
    expect(floatSequence('m07:lance_a', DETERMINISM_DRAWS)).toEqual(
      floatSequence('m07:lance_a', DETERMINISM_DRAWS),
    );
  });

  it('diverges for different seeds', () => {
    const a = floatSequence(1337, 256);
    const b = floatSequence(1338, 256);
    expect(a).not.toEqual(b);
    expect(a.filter((value, index) => value === b[index]).length).toBeLessThan(4);
  });

  it('never repeats a draw within 10,000 (state is 128-bit, not 32-bit)', () => {
    const unique = new Set(floatSequence('collision_probe', DETERMINISM_DRAWS));
    expect(unique.size).toBe(DETERMINISM_DRAWS);
  });

  it('pins the generator algorithm to a known fingerprint', () => {
    expect(fingerprint(1337, DETERMINISM_DRAWS)).toBe(65746360);
    expect(fingerprint('ironline', DETERMINISM_DRAWS)).toBe(3527563011);
  });

  it('resumes an identical stream from a saved state', () => {
    const rng = createRng('save_probe');
    for (let index = 0; index < 500; index += 1) rng.next();

    const state = rng.save();
    const expected = Array.from({ length: 1000 }, () => rng.next());

    rng.restore(state);
    expect(Array.from({ length: 1000 }, () => rng.next())).toEqual(expected);
    expect(Array.from({ length: 1000 }, () => rngFromState(state).next())[0]).toBe(expected[0]);
  });

  it('derives the same state from the same seed', () => {
    expect(stateFromSeed('m07')).toEqual(stateFromSeed('m07'));
    expect(stateFromSeed('m07')).not.toEqual(stateFromSeed('m08'));
  });

  it('keeps saved state as unsigned 32-bit words, so it survives a JSON round trip', () => {
    const rng = createRng('serialisation');
    for (let index = 0; index < 1000; index += 1) {
      rng.next();
      for (const word of Object.values(rng.save())) {
        expect(Number.isInteger(word)).toBe(true);
        expect(word).toBeGreaterThanOrEqual(0);
        expect(word).toBeLessThan(4294967296);
      }
    }

    const state = rng.save();
    const restored = rngFromState(JSON.parse(JSON.stringify(state)));
    expect(restored.next()).toBe(rngFromState(state).next());
  });
});

describe('next', () => {
  it('stays within [0, 1)', () => {
    const rng = createRng('bounds');
    for (let index = 0; index < DETERMINISM_DRAWS; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = createRng('uniformity');
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let index = 0; index < samples; index += 1) {
      const bucket = Math.floor(rng.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples * 0.09);
      expect(count).toBeLessThan(samples * 0.11);
    }
  });
});

describe('int', () => {
  it('stays within [min, max)', () => {
    const rng = createRng('int_bounds');
    for (let index = 0; index < 5000; index += 1) {
      const value = rng.int(2, 8);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(8);
    }
  });

  it('covers every value in a small range', () => {
    const rng = createRng('int_coverage');
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) seen.add(rng.int(0, 8));
    expect(seen.size).toBe(8);
  });

  it('rejects bad bounds', () => {
    const rng = createRng('int_errors');
    expect(() => rng.int(5, 5)).toThrow(RangeError);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(RangeError);
  });
});

describe('chance', () => {
  it('honours the probability', () => {
    const rng = createRng('chance');
    let hits = 0;
    for (let index = 0; index < 20_000; index += 1) if (rng.chance(0.25)) hits += 1;
    expect(hits / 20_000).toBeCloseTo(0.25, 2);
  });

  it('treats 0 and 1 as certainties without desynchronising the stream', () => {
    const impossible = createRng('certainty');
    const certain = createRng('certainty');
    const plain = createRng('certainty');

    expect(impossible.chance(0)).toBe(false);
    expect(certain.chance(1)).toBe(true);
    plain.next();

    expect(impossible.save()).toEqual(plain.save());
    expect(certain.save()).toEqual(plain.save());
    expect(impossible.next()).toBe(certain.next());
  });
});

describe('pick, shuffle and weighted', () => {
  const items = ['head', 'centre_torso', 'left_arm', 'right_leg'] as const;

  it('picks members of the array', () => {
    const rng = createRng('pick');
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual([...items].sort());
  });

  it('shuffles into a permutation without mutating the input', () => {
    const rng = createRng('shuffle');
    const source = [...items];
    const shuffled = rng.shuffle(source);
    expect(source).toEqual([...items]);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it('resolves weighted tables in proportion', () => {
    const rng = createRng('weighted');
    const table = [
      { value: 'centre_torso', weight: 20 },
      { value: 'left_torso', weight: 13 },
      { value: 'head', weight: 2 },
    ] as const;

    const counts = new Map<string, number>();
    const samples = 50_000;
    for (let index = 0; index < samples; index += 1) {
      const value = rng.weighted(table);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    expect((counts.get('centre_torso') ?? 0) / samples).toBeCloseTo(20 / 35, 2);
    expect((counts.get('head') ?? 0) / samples).toBeCloseTo(2 / 35, 2);
  });

  it('rejects empty and zero-weight tables', () => {
    const rng = createRng('weighted_errors');
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.weighted([])).toThrow(RangeError);
    expect(() => rng.weighted([{ value: 'a', weight: 0 }])).toThrow(RangeError);
    expect(() => rng.weighted([{ value: 'a', weight: -1 }])).toThrow(RangeError);
  });
});

describe('fork', () => {
  it('is deterministic and label-dependent', () => {
    const first = createRng('fork').fork('lance_a');
    const second = createRng('fork').fork('lance_a');
    const other = createRng('fork').fork('lance_b');

    const a = Array.from({ length: 256 }, () => first.next());
    const b = Array.from({ length: 256 }, () => second.next());
    const c = Array.from({ length: 256 }, () => other.next());

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('does not share a stream with its parent', () => {
    const parent = createRng('fork_independence');
    const child = parent.fork('child');
    const parentDraws = Array.from({ length: 128 }, () => parent.next());
    const childDraws = Array.from({ length: 128 }, () => child.next());
    expect(parentDraws).not.toEqual(childDraws);
  });
});
