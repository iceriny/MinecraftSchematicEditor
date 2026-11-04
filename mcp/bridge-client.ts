import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { EditorCommand } from "../src/automation/protocol";

export interface BrowserBridge {
  status(): Promise<Record<string, unknown>>;
  command(command: EditorCommand, clientId?: string): Promise<unknown>;
}

const unavailable = "网页编辑桥未连接。请运行编辑器的启动入口，并在浏览器打开 http://127.0.0.1:5173/。";

export class BridgeClient implements BrowserBridge {
  constructor(
    private readonly runtimeFile = fileURLToPath(new URL("../run.local/mcp-bridge.json", import.meta.url)),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let config: { token: string; url: string };
    try {
      config = JSON.parse(await readFile(this.runtimeFile, "utf8"));
    } catch {
      throw new Error(unavailable);
    }
    let origin: URL;
    try { origin = new URL(config.url); }
    catch { throw new Error("编辑桥的运行配置 URL 无效，请重新启动编辑器。"); }
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
        origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
        typeof config.token !== "string" || !config.token) {
      throw new Error("编辑桥配置必须使用本机 127.0.0.1 HTTP 地址和有效 token。");
    }
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, origin), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(body === undefined ? 3000 : 45_000),
        redirect: "error",
      });
    } catch {
      throw new Error(unavailable);
    }
    let result: Record<string, unknown>;
    try { result = await response.json() as Record<string, unknown>; }
    catch { throw new Error("编辑桥返回了无效响应，请确认端口 5173 运行的是本编辑器。"); }
    if (!response.ok || typeof result.error === "string") {
      throw new Error(typeof result.error === "string" ? result.error : `编辑桥请求失败（HTTP ${response.status}）。`);
    }
    return result;
  }

  status() { return this.request("/__mcp/status"); }

  async command(command: EditorCommand, clientId?: string): Promise<unknown> {
    const response = await this.request("/__mcp/command", { command, ...(clientId ? { clientId } : {}) });
    return response.result;
  }
}
