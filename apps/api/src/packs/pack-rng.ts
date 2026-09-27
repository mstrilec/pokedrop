import { createHmac, randomBytes } from 'node:crypto';

export const SEED_BYTES = 32;

const TWO_POW_32 = 2 ** 32;

export function newSeed(): Buffer {
  return randomBytes(SEED_BYTES);
}

export interface Rng {
  int(max: number): number;
}

/**
 * HMAC-SHA256(seed, counter) in counter mode: deterministic for a seed, and as
 * unpredictable as the seed is. The block layout is part of what a stored seed
 * reproduces - changing it silently changes every past pack's replay.
 */
export class SeededRng implements Rng {
  private readonly seed: Buffer;
  private counter = 0n;
  private block = Buffer.alloc(0);
  private offset = 0;

  constructor(seed: Buffer) {
    if (seed.length !== SEED_BYTES) {
      throw new RangeError(`A seed is ${SEED_BYTES} bytes, got ${seed.length}`);
    }
    this.seed = Buffer.from(seed);
  }

  nextUint32(): number {
    if (this.offset === this.block.length) {
      const message = Buffer.alloc(8);
      message.writeBigUInt64BE(this.counter);
      this.counter += 1n;
      this.block = createHmac('sha256', this.seed).update(message).digest();
      this.offset = 0;
    }

    const value = this.block.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  int(max: number): number {
    if (!Number.isInteger(max) || max < 1 || max > TWO_POW_32) {
      throw new RangeError(`int(max) needs an integer in [1, 2^32], got ${max}`);
    }

    const limit = TWO_POW_32 - (TWO_POW_32 % max);
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % max;
  }
}
