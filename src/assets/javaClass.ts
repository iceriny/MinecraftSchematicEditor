/** Reads symbolic references from class files. It never loads or executes Java code. */
export interface JavaMember {
  owner: string;
  name: string;
  descriptor: string;
}

export interface JavaInstruction {
  op: number;
  operand?: number;
  text?: string;
  type?: string;
  ref?: JavaMember;
  bootstrap?: JavaMember[];
  bootstrapMethod?: JavaMember;
  concatRecipe?: string;
}

export interface JavaClass {
  name: string;
  methods: { name: string; descriptor: string; code: JavaInstruction[] }[];
}

class Reader {
  pos = 0;
  private view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  byte() { return this.view.getUint8(this.pos++); }
  short() { const value = this.view.getUint16(this.pos); this.pos += 2; return value; }
  int() { const value = this.view.getUint32(this.pos); this.pos += 4; return value; }
  take(count: number) {
    const start = this.pos;
    this.pos += count;
    if (this.pos > this.bytes.length) throw new RangeError("Truncated class data");
    return this.bytes.subarray(start, this.pos);
  }
}

interface Constant { tag: number; a?: number; b?: number; text?: string }
const utf8 = new TextDecoder();

function readPool(input: Reader) {
  const pool: Constant[] = new Array(input.short());
  for (let i = 1; i < pool.length; i++) {
    const tag = input.byte();
    const entry = pool[i] = { tag } as Constant;
    switch (tag) {
      case 1: entry.text = utf8.decode(input.take(input.short())); break;
      case 3: case 4: input.take(4); break;
      case 5: case 6: input.take(8); i++; break;
      case 7: case 8: case 16: case 19: case 20: entry.a = input.short(); break;
      case 9: case 10: case 11: case 12: case 17: case 18:
        entry.a = input.short(); entry.b = input.short(); break;
      case 15: entry.a = input.byte(); entry.b = input.short(); break;
      default: throw new Error("Unknown constant pool tag");
    }
  }
  return pool;
}

// Fixed-width operands of JVM instructions. Switch tables and wide locals
// encode their own size and are skipped separately below.
const widths = new Uint8Array(0xca);
for (const op of [0x10,0x12,0xa9,0xbc]) widths[op] = 1;
widths.fill(1, 0x15, 0x1a); widths.fill(1, 0x36, 0x3b);
for (const op of [0x11,0x13,0x14,0x84,0xbb,0xbd,0xc0,0xc1,0xc6,0xc7]) widths[op] = 2;
widths.fill(2, 0x99, 0xa9); widths.fill(2, 0xb2, 0xb9);
widths[0xc5] = 3;
for (const op of [0xb9,0xba,0xc8,0xc9]) widths[op] = 4;

export function readJavaClass(bytes: Uint8Array): JavaClass | undefined {
  try {
    const input = new Reader(bytes);
    if (input.int() !== 0xcafebabe) return;
    input.take(4);
    const pool = readPool(input);
    const string = (i?: number) => pool[i ?? 0]?.text ?? "";
    const className = (i?: number) => string(pool[i ?? 0]?.a);
    function member(index?: number): JavaMember | undefined {
      const entry = pool[index ?? 0];
      if (!entry || ![9,10,11,18].includes(entry.tag)) return;
      const signature = pool[entry.b!];
      return { owner: entry.tag === 18 ? "" : className(entry.a),
        name: string(signature.a), descriptor: string(signature.b) };
    }
    const handle = (i: number) => pool[i]?.tag === 15 ? member(pool[i].b) : undefined;
    function attributes(reader: Reader, visit?: (key: string, data: Uint8Array) => void) {
      for (let count = reader.short(); count > 0; count--) {
        const key = string(reader.short()), data = reader.take(reader.int());
        visit?.(key, data);
      }
    }
    input.short();
    const name = className(input.short());
    input.short();
    input.take(2 * input.short());
    for (let count = input.short(); count > 0; count--) { input.take(6); attributes(input); }
    const methods = [];
    for (let count = input.short(); count > 0; count--) {
      input.short();
      const methodName = string(input.short()), descriptor = string(input.short());
      let code = new Uint8Array(0) as Uint8Array;
      attributes(input, (attribute, data) => {
        if (attribute !== "Code") return;
        const body = new Reader(data);
        body.take(4);
        code = body.take(body.int());
      });
      methods.push({name: methodName, descriptor, code});
    }
    const bootstrap: { method?: JavaMember; args: number[] }[] = [];
    attributes(input, (attribute, data) => {
      if (attribute !== "BootstrapMethods") return;
      const body = new Reader(data);
      for (let count = body.short(); count > 0; count--) {
        const method = handle(body.short());
        const args = Array.from({length: body.short()}, () => body.short());
        bootstrap.push({method, args});
      }
    });

    function instructions(bytes: Uint8Array): JavaInstruction[] {
      const code = new Reader(bytes), result: JavaInstruction[] = [];
      while (code.pos < bytes.length) {
        const op = code.byte(), ins: JavaInstruction = {op};
        if (op >= widths.length) throw new Error("Invalid JVM instruction");
        if (op === 0xaa || op === 0xab) {
          code.take((4 - (code.pos % 4)) % 4);
          code.int();
          if (op === 0xab) code.take(8 * code.int());
          else {
            const low = code.int() | 0, high = code.int() | 0;
            if (high < low) throw new RangeError("Invalid tableswitch");
            code.take(4 * (1 + high - low));
          }
        } else if (op === 0xc4) {
          const wideOp = code.byte();
          code.take(wideOp === 0x84 ? 4 : 2);
        } else if (widths[op]) {
          const args = code.take(widths[op]);
          const index = ins.operand = args.length === 1 ? args[0] : args[0] * 256 + args[1];
          if (op >= 0xb2 && op <= 0xba) ins.ref = member(index);
          if (op === 0xbb || op === 0xbd || op === 0xc0 || op === 0xc1) ins.type = className(index);
          if (op === 0x12 || op === 0x13) {
            if (pool[index]?.tag === 8) ins.text = string(pool[index].a);
            if (pool[index]?.tag === 7) ins.type = className(index);
          }
          if (op === 0xba) {
            const binding = bootstrap[pool[index].a!];
            if (binding) {
              ins.bootstrapMethod = binding.method;
              ins.bootstrap = binding.args.flatMap(arg => handle(arg) ?? []);
              const recipe = binding.args[0];
              if (pool[recipe]?.tag === 8) ins.concatRecipe = string(pool[recipe].a);
            }
          }
        }
        result.push(ins);
      }
      return result;
    }
    return {name, methods: methods.map(m => ({...m, code: instructions(m.code)}))};
  } catch {
    return undefined;
  }
}
