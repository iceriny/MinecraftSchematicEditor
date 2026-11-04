import type { Build } from "../core/model";
import type { FillMode } from "../core/region";

export type Vec3 = [number, number, number];
export const captureAngles = ["south", "north", "east", "west", "southeast", "southwest", "northeast", "northwest", "top"] as const;
export type CaptureAngle = (typeof captureAngles)[number];
export interface CaptureOptions {
  angles: CaptureAngle[];
  tileSize: number;
  center?: Vec3;
  span?: number;
  box?: Box;
}
export interface Box { min: Vec3; max: Vec3 }
export type EditOperation =
  | { type: "fill"; box: Box; block: string; shape?: FillMode }
  | { type: "set"; blocks: { at: Vec3; block: string }[] }
  | { type: "paint"; block: string; at: Vec3[] }
  | { type: "replace"; from: string; to: string; box?: Box }
  | { type: "copy"; box: Box; to: Vec3; rotate?: 0 | 1 | 2 | 3; mirror?: "x" | "z"; includeAir?: boolean }
  | { type: "move"; box: Box; to: Vec3 };

export type EditorCommand =
  | { action: "status" }
  | { action: "new"; size: Vec3; name?: string; newTab?: boolean }
  | { action: "open"; name: string; data: string; newTab?: boolean }
  | { action: "export"; format: "litematic" | "schem" | "nbt"; expectedRevision?: number; expectedDocumentId?: string }
  | { action: "inspect"; mode?: "blocks" | "materials"; box?: Box; limit?: number; offset?: number; includeAir?: boolean }
  | { action: "edit"; origin?: Vec3; operations: EditOperation[]; label?: string; expectedRevision?: number; expectedDocumentId?: string }
  | { action: "history"; direction: "undo" | "redo"; steps?: number }
  | { action: "resources"; operation: "list" | "load_version" | "add_mod"; version?: string; instance?: string; file?: string }
  | { action: "view"; frame?: boolean; layer?: number; capture?: CaptureOptions }
  | { action: "documents"; operation: "list" | "switch" | "close"; documentId?: string };

/** Browser and headless editors share the same validated editing engine. */
export interface EditorHost {
  getBuild(): Build | null;
  getDocumentId?(): string | null;
  getRevision(): number;
  getHistory(): { undo: number; redo: number };
  adoptBuild(build: Build, fileName: string | null, newTab: boolean): void;
  commit(label: string, indices: Uint32Array, values: Uint16Array): void;
  undo(): void;
  redo(): void;
}

export interface BridgeRequest { id: string; command: EditorCommand }
export interface BridgeReply { id: string; result?: unknown; error?: string }
