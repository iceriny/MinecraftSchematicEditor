import { useStore } from "../store";
import { executeCommand } from "./engine";
import type { BridgeRequest, EditorCommand, EditorHost } from "./protocol";
import { findInstalledVersions, findInstances } from "../assets/pack";

const host: EditorHost = {
  getBuild: () => useStore.getState().build,
  getDocumentId: () => useStore.getState().activeDoc,
  getRevision: () => useStore.getState().revision,
  getHistory: () => ({ undo: useStore.getState().undoStack.length, redo: useStore.getState().redoStack.length }),
  adoptBuild: (build, fileName, newTab) => useStore.getState().automationAdopt(build, fileName, newTab),
  commit: (label, indices, values) => useStore.getState().automationCommit(label, indices, values),
  undo: () => useStore.getState().undo(),
  redo: () => useStore.getState().redo(),
};

async function handle(command: EditorCommand): Promise<unknown> {
  const state = useStore.getState();
  if (command.action === "export") {
    // The export already includes its identity, captured before asynchronous compression.
    return executeCommand(command, host);
  }
  if (command.action === "documents") {
    if (command.operation !== "list") {
      if (!command.documentId || !state.docs.some((doc) => doc.id === command.documentId)) {
        throw new Error("Choose an existing documentId from schematic_documents.");
      }
      if (command.operation === "switch") state.switchDoc(command.documentId);
      else if (command.operation === "close") state.closeDoc(command.documentId);
      else throw new Error("Unknown document operation.");
    }
    return { activeDoc: useStore.getState().activeDoc, documents: useStore.getState().docs };
  }
  if (command.action === "resources") {
    if (command.operation === "load_version") {
      if (!command.version) throw new Error("version is required.");
      await state.useInstalledVersion(command.version);
      const next = useStore.getState();
      if (next.packError || next.packStatus !== "ready") throw new Error(next.packError ?? "Could not load textures.");
    } else if (command.operation === "add_mod") {
      if (!command.instance || !command.file) throw new Error("instance and file are required.");
      await state.addInstanceMod(command.instance, command.file);
      if (useStore.getState().modError) throw new Error(useStore.getState().modError!);
    }
    const [versions, instances] = await Promise.all([findInstalledVersions(), findInstances()]);
    const next = useStore.getState();
    return { versions, instances, pack: next.packName, packStatus: next.packStatus, mods: next.modPacks };
  }
  if (command.action === "view") {
    if (command.capture) {
      const { captureBrowser } = await import("./capture");
      return captureBrowser(command.capture);
    }
    if (command.layer !== undefined) {
      if (!Number.isInteger(command.layer) || !state.build || command.layer < 0 || command.layer >= state.build.height) {
        throw new Error("layer must be an integer inside the current build.");
      }
      state.setLayerLimit(command.layer);
    }
    if (command.frame) state.frameBuild();
    return { layer: useStore.getState().layerLimit };
  }
  const result = await executeCommand(command, host);
  return { ...result, activeDoc: useStore.getState().activeDoc, documents: useStore.getState().docs };
}

if (import.meta.hot) {
  const hot = import.meta.hot;
  hot.accept();
  const clientId = crypto.randomUUID();
  let queue = Promise.resolve();
  const cancelled = new Set<string>();
  const announce = () => {
    const state = useStore.getState();
    hot.send("mcp:hello", {
      id: clientId,
      name: state.build?.meta.name ?? null,
      fileName: state.fileName,
      size: state.build ? [state.build.width, state.build.height, state.build.length] : null,
      blocks: state.build?.totalBlocks() ?? 0,
      revision: state.revision,
    });
  };
  const onCommand = (request: BridgeRequest) => {
    queue = queue.then(async () => {
      if (cancelled.delete(request.id)) return;
      try {
        const result = await handle(request.command);
        hot.send("mcp:result", { id: request.id, result });
      } catch (cause) {
        hot.send("mcp:result", { id: request.id, error: cause instanceof Error ? cause.message : String(cause) });
      }
      announce();
    });
  };
  const onCancel = ({ id }: { id: string }) => {
    cancelled.add(id);
    // Bound memory when a command finished immediately before its timeout.
    if (cancelled.size > 256) cancelled.delete(cancelled.values().next().value!);
  };
  hot.on("mcp:command", onCommand);
  hot.on("mcp:cancel", onCancel);
  hot.on("vite:ws:connect", announce);
  const timer = setInterval(announce, 5000);
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.revision !== previous.revision || state.activeDoc !== previous.activeDoc) announce();
  });
  announce();
  hot.dispose(() => {
    clearInterval(timer);
    unsubscribe();
    hot.off("mcp:command", onCommand);
    hot.off("mcp:cancel", onCancel);
    hot.off("vite:ws:connect", announce);
    hot.send("mcp:bye", { id: clientId });
  });
}
