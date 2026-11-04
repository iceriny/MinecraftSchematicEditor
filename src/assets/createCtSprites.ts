import { readJavaClass, type JavaClass, type JavaInstruction } from "./javaClass";

export const CREATE_SHIFT_CLASS = "com/simibubi/create/AllSpriteShifts.class";

export interface CreateCtSprite {
  original: string;
  target: string;
  type: string;
}

const create = "com/simibubi/create/";
const ct = create + "foundation/block/connected/";
type Value = string | { layout: string } | CreateCtSprite;

/**
 * Read the literal expression assigned to each CTSpriteShiftEntry. Helper
 * calls are followed only when their whole body is a single return expression.
 * The path prefixes and atlas suffix come from the jar's own concat recipes.
 */
export function readCreateCtSprites(files: Record<string, Uint8Array>): Map<string, CreateCtSprite> {
  const entries = new Map<string, CreateCtSprite>();
  const bytes = files[CREATE_SHIFT_CLASS];
  const cls = bytes && readJavaClass(bytes);
  if (!cls || cls.name + ".class" !== CREATE_SHIFT_CLASS) return entries;
  const init = cls.methods.find(method => method.name === "<clinit>");
  if (!init) return entries;
  for (let i = 0; i < init.code.length; i++) {
    const {op, ref} = init.code[i];
    if (op !== 0xb3 || ref?.owner !== cls.name || ref.descriptor !== "L" + ct + "CTSpriteShiftEntry;") continue;
    const value = expression(cls, init.code, {at: i - 1}, [], 0);
    if (value && typeof value === "object" && "original" in value) entries.set(ref.owner + "." + ref.name, value);
  }
  return entries;
}

function expression(
  cls: JavaClass, code: JavaInstruction[], cursor: { at: number }, locals: Value[], depth: number,
): Value | undefined {
  if (depth > 24) return;
  const ins = code[cursor.at--];
  if (!ins) return;
  if (ins.text !== undefined) return ins.text;
  if (ins.op >= 0x2a && ins.op <= 0x2d) return locals[ins.op - 0x2a];
  if (ins.op === 0x19) return locals[ins.operand!];
  const ref = ins.ref;
  if (!ref) return;
  if (ins.op === 0xb2 && ref.owner === ct + "AllCTTypes") return { layout: ref.name };
  if (ins.op !== 0xb8 && ins.op !== 0xba) return;

  // Only object/string arguments occur in the supported registration APIs.
  const params = /^\(((?:L[^;]+;)*)\)/.exec(ref.descriptor)?.[1];
  if (params === undefined) return;
  const args: Value[] = [];
  for (let i = params.split(";").length - 1; i > 0; i--) {
    const value = expression(cls, code, cursor, locals, depth + 1);
    if (value === undefined) return;
    args.unshift(value);
  }
  if (ins.op === 0xba && ins.bootstrapMethod?.owner === "java/lang/invoke/StringConcatFactory" &&
      ins.concatRecipe !== undefined && !ins.concatRecipe.includes("\x02") && args.every(v => typeof v === "string")) {
    const parts = ins.concatRecipe.split("\x01");
    if (parts.length === args.length + 1) return parts.reduce((text, part, i) => text + args[i - 1] + part);
  }
  if (ref.owner === create + "Create" && ref.name === "asResource" && typeof args[0] === "string")
    return "create:" + args[0];
  if (ref.owner === ct + "CTSpriteShifter" && ref.name === "getCT") {
    const [type, original, target] = args;
    if (typeof type === "object" && "layout" in type && typeof original === "string" && typeof target === "string")
      return { type: type.layout, original, target };
  }
  if (ref.owner !== cls.name) return;
  const helper = cls.methods.find(m => m.name === ref.name && m.descriptor === ref.descriptor);
  if (!helper || helper.code.at(-1)?.op !== 0xb0) return;
  const body = {at: helper.code.length - 2};
  const result = expression(cls, helper.code, body, args, depth + 1);
  return body.at === -1 ? result : undefined;
}
