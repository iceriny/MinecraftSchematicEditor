/**
 * Litematica's packed block array. Entries are `bits` wide and pack tightly
 * across long boundaries — this is the pre-1.16 chunk packing, not the padded
 * form modern region files use, so an entry can straddle two longs.
 *
 * BigInt reads are far too slow at build scale, so longs are split into 32-bit
 * halves once and everything after that is plain integer maths.
 */

/** Bits per entry Litematica uses for a palette of this size. */
export function bitsForPalette(paletteSize: number): number {
  return Math.max(2, 32 - Math.clz32(Math.max(1, paletteSize - 1)));
}

export function unpack(longs: BigInt64Array, bits: number, count: number): Uint16Array {
  const words = longs.length;
  const lo = new Uint32Array(words);
  const hi = new Uint32Array(words);
  for (let i = 0; i < words; i++) {
    const v = BigInt.asUintN(64, longs[i]);
    lo[i] = Number(v & 0xffffffffn);
    hi[i] = Number(v >> 32n);
  }

  const mask = bits >= 32 ? 0xffffffff : ((1 << bits) - 1) >>> 0;
  const out = new Uint16Array(count);

  for (let i = 0; i < count; i++) {
    const start = i * bits;
    const startWord = Math.floor(start / 64);
    const startBit = start - startWord * 64;
    const endWord = Math.floor((start + bits - 1) / 64);
    if (startWord >= words) break;

    let value: number;
    if (startBit < 32) {
      value = startBit === 0 ? lo[startWord] : (lo[startWord] >>> startBit) | (hi[startWord] << (32 - startBit));
    } else {
      value = hi[startWord] >>> (startBit - 32);
    }
    if (endWord !== startWord && endWord < words) {
      // bits <= 32 means a straddling entry always has startBit > 32,
      // so the remaining shift is in 1..31 and the low half is enough.
      value |= lo[endWord] << (64 - startBit);
    }
    out[i] = (value & mask) >>> 0;
  }
  return out;
}

export function pack(values: Uint16Array, bits: number): BigInt64Array {
  const totalBits = values.length * bits;
  const words = Math.ceil(totalBits / 64);
  const lo = new Uint32Array(words);
  const hi = new Uint32Array(words);

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const start = i * bits;
    const startWord = Math.floor(start / 64);
    const startBit = start - startWord * 64;
    const endWord = Math.floor((start + bits - 1) / 64);

    if (startBit < 32) {
      lo[startWord] |= (value << startBit) >>> 0;
      if (startBit + bits > 32) hi[startWord] |= value >>> (32 - startBit);
    } else {
      hi[startWord] |= (value << (startBit - 32)) >>> 0;
    }
    if (endWord !== startWord) {
      lo[endWord] |= value >>> (64 - startBit);
    }
  }

  const out = new BigInt64Array(words);
  for (let i = 0; i < words; i++) {
    out[i] = BigInt.asIntN(64, (BigInt(hi[i]) << 32n) | BigInt(lo[i]));
  }
  return out;
}

/* --------------------------------------------------------------- varints */

/** Reads Sponge's varint-encoded block data out of a signed byte array. */
export function readVarints(bytes: Int8Array, count: number): Uint16Array {
  const out = new Uint16Array(count);
  let pos = 0;
  for (let i = 0; i < count && pos < bytes.length; i++) {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[pos++] & 0xff;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 35 || pos >= bytes.length) break;
    }
    out[i] = value;
  }
  return out;
}

export function writeVarints(values: Uint16Array): Int8Array {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    let value = values[i];
    while ((value & ~0x7f) !== 0) {
      out.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    out.push(value);
  }
  return Int8Array.from(out, (b) => (b << 24) >> 24);
}
