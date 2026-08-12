/**
 * Minimal Java-Edition NBT reader/writer. Big-endian, no dependencies.
 *
 * Reading produces plain JS values so consumers can pluck fields without
 * unwrapping. Writing is explicit — every scalar is tagged at the call site,
 * because NBT cares about the difference between a short and an int and JS
 * does not.
 */

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;

export type TagId = (typeof TAG)[keyof typeof TAG];

export type NbtCompound = { [key: string]: NbtValue };
export type NbtValue =
  | number
  | bigint
  | string
  | Int8Array
  | Int32Array
  | BigInt64Array
  | NbtValue[]
  | NbtCompound;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/* ------------------------------------------------------------------ read */

class Reader {
  private view: DataView;
  private pos = 0;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset() {
    return this.pos;
  }

  u8(): number {
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    return this.view.getInt8(this.pos++);
  }
  i16(): number {
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  i64(): bigint {
    const v = this.view.getBigInt64(this.pos);
    this.pos += 8;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  str(): string {
    const len = this.u16();
    const s = textDecoder.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  /** Copies out of the source buffer so results survive buffer reuse. */
  private slice(byteLength: number): ArrayBuffer {
    const out = this.bytes.slice(this.pos, this.pos + byteLength);
    this.pos += byteLength;
    return out.buffer as ArrayBuffer;
  }

  byteArray(): Int8Array {
    const len = this.i32();
    return new Int8Array(this.slice(len));
  }

  intArray(): Int32Array {
    const len = this.i32();
    const out = new Int32Array(len);
    for (let i = 0; i < len; i++) out[i] = this.i32();
    return out;
  }

  longArray(): BigInt64Array {
    const len = this.i32();
    const out = new BigInt64Array(len);
    for (let i = 0; i < len; i++) out[i] = this.i64();
    return out;
  }

  payload(id: number): NbtValue {
    switch (id) {
      case TAG.Byte:
        return this.i8();
      case TAG.Short:
        return this.i16();
      case TAG.Int:
        return this.i32();
      case TAG.Long:
        return this.i64();
      case TAG.Float:
        return this.f32();
      case TAG.Double:
        return this.f64();
      case TAG.ByteArray:
        return this.byteArray();
      case TAG.String:
        return this.str();
      case TAG.List: {
        const itemId = this.u8();
        const len = this.i32();
        const out: NbtValue[] = [];
        for (let i = 0; i < len; i++) out.push(this.payload(itemId));
        return out;
      }
      case TAG.Compound: {
        const out: NbtCompound = Object.create(null);
        for (;;) {
          const tagId = this.u8();
          if (tagId === TAG.End) break;
          const name = this.str();
          out[name] = this.payload(tagId);
        }
        return out;
      }
      case TAG.IntArray:
        return this.intArray();
      case TAG.LongArray:
        return this.longArray();
      default:
        throw new Error(`Unknown NBT tag id ${id} at byte ${this.pos - 1}`);
    }
  }
}

export interface ParsedNbt {
  /** Name of the root compound. Usually "" or "Schematic". */
  name: string;
  root: NbtCompound;
}

/** Parses an uncompressed NBT byte stream. */
export function parseNbt(bytes: Uint8Array): ParsedNbt {
  const r = new Reader(bytes);
  const id = r.u8();
  if (id !== TAG.Compound) {
    throw new Error(`Not NBT: root tag is ${id}, expected a compound.`);
  }
  const name = r.str();
  return { name, root: r.payload(TAG.Compound) as NbtCompound };
}

/* ----------------------------------------------------------------- write */

/** A value paired with the NBT tag it should be written as. */
export interface Tagged {
  readonly id: TagId;
  readonly value: unknown;
}

const tag = (id: TagId, value: unknown): Tagged => ({ id, value });

export const nbt = {
  byte: (v: number) => tag(TAG.Byte, v),
  short: (v: number) => tag(TAG.Short, v),
  int: (v: number) => tag(TAG.Int, v),
  long: (v: bigint) => tag(TAG.Long, v),
  float: (v: number) => tag(TAG.Float, v),
  double: (v: number) => tag(TAG.Double, v),
  string: (v: string) => tag(TAG.String, v),
  byteArray: (v: Int8Array | Uint8Array) => tag(TAG.ByteArray, v),
  intArray: (v: Int32Array | number[]) => tag(TAG.IntArray, v),
  longArray: (v: BigInt64Array | bigint[]) => tag(TAG.LongArray, v),
  compound: (v: Record<string, Tagged>) => tag(TAG.Compound, v),
  /** `itemId` is required so empty lists still round-trip with the right type. */
  list: (itemId: TagId, v: Tagged[]) => tag(TAG.List, { itemId, items: v }),
};

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private need(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) {
    this.need(1);
    this.view.setUint8(this.pos++, v);
  }
  i16(v: number) {
    this.need(2);
    this.view.setInt16(this.pos, v);
    this.pos += 2;
  }
  i32(v: number) {
    this.need(4);
    this.view.setInt32(this.pos, v);
    this.pos += 4;
  }
  i64(v: bigint) {
    this.need(8);
    this.view.setBigInt64(this.pos, v);
    this.pos += 8;
  }
  f32(v: number) {
    this.need(4);
    this.view.setFloat32(this.pos, v);
    this.pos += 4;
  }
  f64(v: number) {
    this.need(8);
    this.view.setFloat64(this.pos, v);
    this.pos += 8;
  }

  str(v: string) {
    const encoded = textEncoder.encode(v);
    this.i16(encoded.length);
    this.need(encoded.length);
    this.buf.set(encoded, this.pos);
    this.pos += encoded.length;
  }

  payload(t: Tagged) {
    switch (t.id) {
      case TAG.Byte:
        this.u8((t.value as number) & 0xff);
        break;
      case TAG.Short:
        this.i16(t.value as number);
        break;
      case TAG.Int:
        this.i32(t.value as number);
        break;
      case TAG.Long:
        this.i64(t.value as bigint);
        break;
      case TAG.Float:
        this.f32(t.value as number);
        break;
      case TAG.Double:
        this.f64(t.value as number);
        break;
      case TAG.ByteArray: {
        const a = t.value as Int8Array;
        this.i32(a.length);
        this.need(a.length);
        this.buf.set(new Uint8Array(a.buffer, a.byteOffset, a.length), this.pos);
        this.pos += a.length;
        break;
      }
      case TAG.String:
        this.str(t.value as string);
        break;
      case TAG.List: {
        const { itemId, items } = t.value as { itemId: TagId; items: Tagged[] };
        this.u8(items.length === 0 ? itemId : items[0].id);
        this.i32(items.length);
        for (const item of items) this.payload(item);
        break;
      }
      case TAG.Compound: {
        const entries = t.value as Record<string, Tagged>;
        for (const key of Object.keys(entries)) {
          const child = entries[key];
          this.u8(child.id);
          this.str(key);
          this.payload(child);
        }
        this.u8(TAG.End);
        break;
      }
      case TAG.IntArray: {
        const a = t.value as Int32Array;
        this.i32(a.length);
        for (let i = 0; i < a.length; i++) this.i32(a[i]);
        break;
      }
      case TAG.LongArray: {
        const a = t.value as BigInt64Array;
        this.i32(a.length);
        for (let i = 0; i < a.length; i++) this.i64(a[i]);
        break;
      }
      case TAG.End:
        break;
    }
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Serialises a root compound to an uncompressed NBT byte stream. */
export function writeNbt(root: Tagged, rootName = ""): Uint8Array {
  if (root.id !== TAG.Compound) throw new Error("NBT root must be a compound.");
  const w = new Writer();
  w.u8(TAG.Compound);
  w.str(rootName);
  w.payload(root);
  return w.finish();
}

/* ------------------------------------------------------------- accessors */

export function asNumber(v: NbtValue | undefined, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return fallback;
}

export function asString(v: NbtValue | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function asCompound(v: NbtValue | undefined): NbtCompound | undefined {
  return v && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v)
    ? (v as NbtCompound)
    : undefined;
}

export function asList(v: NbtValue | undefined): NbtValue[] {
  return Array.isArray(v) ? v : [];
}

/** Reads an {x,y,z} compound, tolerating either capitalisation. */
export function asVec3(v: NbtValue | undefined): [number, number, number] {
  const c = asCompound(v);
  if (!c) return [0, 0, 0];
  return [
    asNumber(c.x ?? c.X),
    asNumber(c.y ?? c.Y),
    asNumber(c.z ?? c.Z),
  ];
}
