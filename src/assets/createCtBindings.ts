import { readJavaClass, type JavaClass, type JavaInstruction, type JavaMember } from "./javaClass";

/** References point to registration fields, not filenames inferred from a block name. */
export interface CtFaceBinding { side: string; cap?: string }
const create = "com/simibubi/create/";
const factoryName = create + "foundation/data/WindowGen";
const transformersName = create + "foundation/data/BuilderTransformers";
const registrate = create + "foundation/data/CreateRegistrate";
const connected = create + "foundation/block/connected/";
const shiftDescriptor = "L" + connected + "CTSpriteShiftEntry;";
const supplier = "Ljava/util/function/Supplier;";
type Method = JavaClass["methods"][number];

export function isCreateCtBindingClass(path: string): boolean {
  return path === factoryName + ".class" || path === transformersName + ".class" ||
    /(?:^|\/)[^/]*(?:Blocks|BlockRegistry)\.class$/.test(path);
}

function local(instruction?: JavaInstruction): number | undefined {
  if (!instruction) return;
  if (instruction.op >= 0x2a && instruction.op <= 0x2d) return instruction.op - 0x2a;
  if (instruction.op === 0x19) return instruction.operand;
}

function args(descriptor: string): string[] {
  return descriptor.slice(1, descriptor.indexOf(")")).match(/\[*(?:L[^;]+;|[BCDFIJSZ])/g) ?? [];
}

function implementation(cls: JavaClass, instruction?: JavaInstruction) {
  if (instruction?.bootstrapMethod?.owner !== "java/lang/invoke/LambdaMetafactory") return;
  const handles = instruction.bootstrap;
  if (handles?.length !== 1 || handles[0].owner !== cls.name) return;
  const { name, descriptor } = handles[0];
  return cls.methods.find(m => m.name === name && m.descriptor === descriptor);
}

function shiftField(ins?: JavaInstruction): string | undefined {
  if (ins?.op === 0xb2 && ins.ref?.descriptor === shiftDescriptor) return ins.ref.owner + "." + ins.ref.name;
}

// The supported contracts are constructors, with their arguments in declared
// order. The supplier can load a registered field or call its captured supplier.
function behaviour(method: Method | undefined, captured: (string | undefined)[] = []): CtFaceBinding | undefined {
  if (!method) return;
  const code = method.code;
  const ctor = code.at(-2)?.ref;
  if (!ctor || code[0]?.op !== 0xbb || code[0].type !== ctor.owner || code[1]?.op !== 0x59 ||
      code.at(-2)?.op !== 0xb7 || ctor.name !== "<init>" || code.at(-1)?.op !== 0xb0) return;
  const shifts = [];
  for (let i = 2; i < code.length - 2; i++) {
    const field = shiftField(code[i]);
    if (field) { shifts.push(field); continue; }
    const value = captured[local(code[i]) ?? -1];
    if (!value || code[i+1]?.ref?.owner !== "java/util/function/Supplier" ||
        code[i+1].ref?.name !== "get" || code[i+2]?.type !== connected + "CTSpriteShiftEntry") return;
    shifts.push(value);
    i += 2;
  }
  if (!shifts.length || ctor.descriptor !== "(" + shiftDescriptor.repeat(shifts.length) + ")V") return;
  if (ctor.owner === connected + "SimpleCTBehaviour" && shifts.length === 1)
    return {side: shifts[0], cap: shifts[0]};
  if (ctor.owner === connected + "HorizontalCTBehaviour" && shifts.length <= 2)
    return {side: shifts[0], cap: shifts[1]};
}

// WindowGen uses Create.registrate(). Track the block name and behaviour
// supplier through its builder factories and simple forwarding overloads.
interface Factory {
  id: number;
  supply: number;
  wrapper?: Method;
}
function factoryRules(cls: JavaClass): Map<string, Factory> {
  const rules = new Map<string, Factory>();
  if (!cls.methods.find(m => m.name === "<clinit>")?.code.some(i =>
    i.ref?.owner === create + "Create" && i.ref.name === "registrate")) return rules;
  for (const m of cls.methods) {
    const code = m.code;
    const block = code.findIndex(i => i.ref?.owner === registrate && i.ref.name === "block");
    const bind = code.findIndex(i => i.ref?.owner === registrate && i.ref.name === "connectedTextures");
    if (block < 0 || bind < 1 || !m.descriptor.startsWith("(Ljava/lang/String;")) continue;
    // Verify that the actual string supplied to registrate.block is arg 0.
    const owner = code.findIndex(i => i.op === 0xb2 && i.ref?.owner === cls.name &&
      i.ref.descriptor === "L" + registrate + ";");
    if (owner < 0 || owner >= block || local(code[owner + 1]) !== 0) continue;
    const wrapped = code[bind-1].op === 0xba;
    const wrapper = wrapped ? implementation(cls, code[bind-1]) : undefined;
    if (wrapped && !wrapper) continue;
    const index = local(code[bind - (wrapped ? 2 : 1)]);
    if (index === undefined || args(m.descriptor)[index] !== supplier) continue;
    rules.set(m.name + m.descriptor, {id: 0, supply: index, wrapper});
  }
  for (const m of cls.methods) {
    for (const [i, ins] of m.code.entries()) {
      if (ins.op !== 0xb8 || ins.ref?.owner !== cls.name) continue;
      const target = rules.get(ins.ref.name + ins.ref.descriptor);
      if (!target) continue;
      const start = i - args(ins.ref.descriptor).length;
      if (start < 0) continue;
      const loads = m.code.slice(start, i);
      // Only forward direct loads. Bytecode doing dynamic substitutions or
      // selecting a different behaviour must not inherit this binding.
      if (!loads.every(x => x.op >= 0x15 && x.op <= 0x2d)) continue;
      const id = local(loads[target.id]), supply = local(loads[target.supply]);
      if (id === undefined || supply === undefined || args(m.descriptor)[id] !== "Ljava/lang/String;" ||
          args(m.descriptor)[supply] !== supplier) continue;
      rules.set(m.name + m.descriptor, {id, supply, wrapper: target.wrapper});
    }
  }
  return rules;
}

/** Only expressions that push exactly one argument and consume no arguments. */
function isConstantArg(ins: JavaInstruction): boolean {
  return ins.op === 0x01 || (ins.op >= 0x02 && ins.op <= 0x08) ||
    ins.op === 0x12 || ins.op === 0x13 || ins.op === 0xb2 ||
    (ins.op === 0xba && ins.ref?.descriptor.startsWith("()") === true);
}

function registration(cls: JavaClass, code: JavaInstruction[], index: number, ref: JavaMember, rule: Factory) {
  const count = args(ref.descriptor).length;
  const passed = code.slice(Math.max(0, index - count), index);
  if (passed.length !== count || !passed.every(isConstantArg)) return;
  const name = passed[rule.id].text;
  if (!name || !/^[a-z0-9_./-]+$/.test(name)) return;
  const source = implementation(cls, passed[rule.supply]);
  if (!source) return;
  let faces: CtFaceBinding | undefined;
  if (rule.wrapper) {
    if (source.code.length !== 2 || source.code[1].op !== 0xb0) return;
    const sprite = shiftField(source.code[0]);
    if (sprite) faces = behaviour(rule.wrapper, [sprite]);
  } else faces = behaviour(source);
  if (faces) return {id: "create:" + name, faces};
}

// A builder transformer can capture sprite suppliers, then bind a CT
// constructor to the block passed to its apply() callback.
function transformerRules(cls: JavaClass): Map<string, Method> {
  const rules = new Map<string, Method>();
  for (const method of cls.methods) {
    const params = args(method.descriptor);
    const captures = (loads: JavaInstruction[]) =>
      loads.length === params.length && loads.every((ins, index) => local(ins) === index);
    if (!params.length || !params.every(p => p === supplier) || method.code.at(-1)?.op !== 0xb0 ||
        !captures(method.code.slice(0, -2))) continue;
    const callback = implementation(cls, method.code.at(-2));
    if (!callback) continue;
    const i = callback.code.findIndex(ins => ins.ref?.owner === registrate && ins.ref.name === "connectedTextures");
    if (i < params.length + 1 || !captures(callback.code.slice(i - 1 - params.length, i - 1))) continue;
    const ctor = implementation(cls, callback.code[i-1]);
    if (ctor) rules.set(method.name + method.descriptor, ctor);
  }
  return rules;
}

function transformedRegistration(cls: JavaClass, code: JavaInstruction[], index: number, ref: JavaMember, ctor: Method) {
  const count = args(ref.descriptor).length;
  const block = index - count - 1;
  if (block < 3 || code[block].ref?.owner !== registrate || code[block].ref?.name !== "block" ||
      code[block-1].op !== 0xba || code[index+1]?.ref?.owner !== "com/tterrag/registrate/builders/BlockBuilder" ||
      code[index+1].ref?.name !== "transform") return;
  const receiver = code[block-3];
  if (receiver.op !== 0xb2 || receiver.ref?.owner !== cls.name ||
      !code.some((ins, i) => ins.ref?.owner === create + "Create" && ins.ref.name === "registrate" &&
        code[i+1]?.op === 0xb3 && code[i+1].ref?.name === receiver.ref?.name &&
        code[i+1].ref?.owner === receiver.ref?.owner)) return;
  const name = code[block-2].text;
  if (!name || !/^[a-z0-9_./-]+$/.test(name)) return;
  const fields = code.slice(block+1, index).map(producer => {
    const getter = implementation(cls, producer)?.code;
    return getter?.length === 2 && getter[1].op === 0xb0 ? shiftField(getter[0]) : undefined;
  });
  const faces = behaviour(ctor, fields);
  if (faces) return {id: "create:" + name, faces};
}

/** Follow registration calls, lambda bootstrap targets and typed CT constructors. */
export function readCreateCtBindings(files: Record<string, Uint8Array>): Map<string, CtFaceBinding> {
  const result = new Map<string, CtFaceBinding>();
  const factory = files[factoryName + ".class"] && readJavaClass(files[factoryName + ".class"]);
  const transform = files[transformersName + ".class"] && readJavaClass(files[transformersName + ".class"]);
  const rules = factory?.name === factoryName ? factoryRules(factory) : new Map<string, Factory>();
  const transformers = transform?.name === transformersName ? transformerRules(transform) : new Map<string, Method>();
  for (const [path, data] of Object.entries(files)) {
    if (!isCreateCtBindingClass(path) || path === factoryName + ".class" || path === transformersName + ".class") continue;
    const cls = readJavaClass(data);
    if (!cls || path !== cls.name + ".class") continue;
    const code = cls.methods.find(m => m.name === "<clinit>")?.code ?? [];
    for (const [index, ins] of code.entries()) {
      if (ins.op !== 0xb8 || !ins.ref) continue;
      const key = ins.ref.name + ins.ref.descriptor;
      const rule = ins.ref.owner === factoryName && rules.get(key);
      const ctor = ins.ref.owner === transformersName && transformers.get(key);
      const entry = rule ? registration(cls, code, index, ins.ref, rule) :
        ctor ? transformedRegistration(cls, code, index, ins.ref, ctor) : undefined;
      if (entry) result.set(entry.id, entry.faces);
    }
  }
  return result;
}
