export type RngSeed = number | string;

export interface RngState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface WeightedEntry<T> {
  readonly value: T;
  readonly weight: number;
}

export interface Rng {
  nextUint32(): number;
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  weighted<T>(entries: readonly WeightedEntry<T>[]): T;
  fork(label: string): Rng;
  save(): RngState;
  restore(state: RngState): void;
}

const UINT32_RANGE = 4294967296;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashSeed(seed: RngSeed): number {
  const text = typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
    return (mixed ^ (mixed >>> 15)) >>> 0;
  };
}

// xorshift128 degenerates to a constant stream from an all-zero state.
const FALLBACK_STATE: RngState = { x: 0x9e3779b9, y: 0x243f6a88, z: 0xb7e15162, w: 0x85ebca6b };

export function stateFromSeed(seed: RngSeed): RngState {
  const draw = splitmix32(hashSeed(seed));
  const state: RngState = { x: draw(), y: draw(), z: draw(), w: draw() };
  if ((state.x | state.y | state.z | state.w) === 0) return FALLBACK_STATE;
  return state;
}

class Xorshift128 implements Rng {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor(state: RngState) {
    this.x = state.x >>> 0;
    this.y = state.y >>> 0;
    this.z = state.z >>> 0;
    this.w = state.w >>> 0;
  }

  nextUint32(): number {
    const t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = ((this.w ^ (this.w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }

  next(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError(`rng.int expects integer bounds, got [${minInclusive}, ${maxExclusive})`);
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError(`rng.int expects max > min, got [${minInclusive}, ${maxExclusive})`);
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  range(min: number, max: number): number {
    if (!(max > min)) {
      throw new RangeError(`rng.range expects max > min, got [${min}, ${max})`);
    }
    return min + this.next() * (max - min);
  }

  // Always consumes a draw, so a probability of 0 or 1 does not desynchronise the stream.
  chance(probability: number): boolean {
    const roll = this.next();
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return roll < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('rng.pick expects a non-empty array');
    return items[this.int(0, items.length)] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index + 1);
      const held = result[index] as T;
      result[index] = result[swap] as T;
      result[swap] = held;
    }
    return result;
  }

  weighted<T>(entries: readonly WeightedEntry<T>[]): T {
    if (entries.length === 0) throw new RangeError('rng.weighted expects a non-empty table');
    let total = 0;
    for (const entry of entries) {
      if (!(entry.weight >= 0)) {
        throw new RangeError(`rng.weighted expects non-negative weights, got ${entry.weight}`);
      }
      total += entry.weight;
    }
    if (total <= 0) throw new RangeError('rng.weighted expects a positive total weight');

    let roll = this.next() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return entry.value;
    }
    return (entries[entries.length - 1] as WeightedEntry<T>).value;
  }

  fork(label: string): Rng {
    const mixed = (hashSeed(label) ^ this.nextUint32()) >>> 0;
    const draw = splitmix32(mixed);
    const state: RngState = { x: draw(), y: draw(), z: draw(), w: draw() };
    if ((state.x | state.y | state.z | state.w) === 0) return new Xorshift128(FALLBACK_STATE);
    return new Xorshift128(state);
  }

  save(): RngState {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }

  restore(state: RngState): void {
    this.x = state.x >>> 0;
    this.y = state.y >>> 0;
    this.z = state.z >>> 0;
    this.w = state.w >>> 0;
  }
}

export function createRng(seed: RngSeed): Rng {
  return new Xorshift128(stateFromSeed(seed));
}

export function rngFromState(state: RngState): Rng {
  return new Xorshift128(state);
}
