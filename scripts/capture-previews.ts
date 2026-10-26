import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const CANDIDATE_BROWSERS = [
  process.env.BROWSER_BIN,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((item): item is string => Boolean(item));

function findBrowserExecutable(): string {
  const found = CANDIDATE_BROWSERS.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("未找到可用的本机 Edge 或 Chrome 浏览器，可通过环境变量 BROWSER_BIN 指定路径");
  }
  return found;
}

class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (payload.id == null) return;
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        entry.reject(new Error(payload.error.message ?? "CDP 调用失败"));
      } else {
        entry.resolve(payload.result);
      }
    });
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      ws.addEventListener("open", () => resolvePromise(), { once: true });
      ws.addEventListener("error", () => rejectPromise(new Error(`连接 CDP WebSocket 失败: ${wsUrl}`)), {
        once: true,
      });
    });
    return new CdpSession(ws);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: (val) => resolvePromise(val as T),
        reject: rejectPromise,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("CDP 会话已关闭"));
    }
    this.pending.clear();
    this.ws.close();
  }
}

async function launchHeadlessCdp(browserBin: string, userDataDir: string) {
  const child = spawn(
    browserBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const debugPort = await new Promise<number>((resolvePort, rejectPort) => {
    let stderrText = "";
    const timeout = setTimeout(() => {
      rejectPort(new Error(`等待浏览器调试端口超时: ${stderrText}`));
    }, 10_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
      const match = stderrText.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      }
    });

    child.once("error", (err) => {
      clearTimeout(timeout);
      rejectPort(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectPort(new Error(`浏览器提前退出 (code=${code}): ${stderrText}`));
    });
  });

  const targetsResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = (await targetsResponse.json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("未找到可用的浏览器页面调试目标");
  }

  const session = await CdpSession.connect(pageTarget.webSocketDebuggerUrl);
  return { child, session };
}

async function evaluateJson<T>(session: CdpSession, expression: string): Promise<T> {
  const response = await session.send<{
    result: { value?: string };
    exceptionDetails?: { text?: string };
  }>("Runtime.evaluate", {
    expression: `Promise.resolve(${expression}).then((v) => JSON.stringify(v))`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(`页面脚本执行异常: ${response.exceptionDetails.text ?? "unknown"}`);
  }
  return JSON.parse(response.result.value ?? "null") as T;
}

async function navigateAndWaitReady(session: CdpSession, url: string) {
  await session.send("Page.navigate", { url });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await evaluateJson<boolean>(
      session,
      `document.readyState === "complete" && document.documentElement.dataset.captureReady === "true" && (!document.fonts || document.fonts.status === "loaded")`,
    );
    if (ready) {
      await new Promise((r) => setTimeout(r, 120));
      return;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`等待预览页渲染就绪超时: ${url}`);
}

type ClipBox = { id: string; x: number; y: number; width: number; height: number };

async function captureReadmeAssets(session: CdpSession, baseUrl: string, root: string) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1200,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await session.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });

  await navigateAndWaitReady(session, `${baseUrl}/?preview=readme&capture=1`);

  const boxes = await evaluateJson<ClipBox[]>(
    session,
    `Array.from(document.querySelectorAll("[data-readme-id]")).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-readme-id") || "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    })`,
  );

  const outDir = resolve(root, "docs/images");
  mkdirSync(outDir, { recursive: true });

  for (const box of boxes) {
    const { data } = await session.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        scale: 1,
      },
    });
    const outPath = resolve(outDir, `${box.id}.png`);
    writeFileSync(outPath, Buffer.from(data, "base64"));
    console.log(`已生成 README 预览图: docs/images/${box.id}.png (${box.width * 2}x${box.height * 2}px)`);
  }
}

async function captureMatrixOverview(session: CdpSession, baseUrl: string, root: string) {
  await session.send("Emulation.setDefaultBackgroundColorOverride", {
    color: { r: 6, g: 8, b: 13, a: 1 },
  });
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1800,
    height: 2600,
    deviceScaleFactor: 2,
    mobile: false,
  });

  await navigateAndWaitReady(session, `${baseUrl}/?preview=matrix&capture=1`);

  const box = await evaluateJson<ClipBox | null>(
    session,
    `(() => {
      const el = document.querySelector("[data-matrix-root]");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        id: "island-matrix",
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    })()`,
  );
  if (!box) {
    throw new Error("未找到 [data-matrix-root] 节点");
  }

  await session.send("Emulation.setDeviceMetricsOverride", {
    width: Math.max(1800, box.x + box.width + 20),
    height: Math.max(1200, box.y + box.height + 20),
    deviceScaleFactor: 2,
    mobile: false,
  });

  const { data } = await session.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      scale: 1,
    },
  });

  const outDir = resolve(root, "artifacts.local");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "island-matrix.png");
  writeFileSync(outPath, Buffer.from(data, "base64"));
  console.log(`已生成全形态矩阵预览图: artifacts.local/island-matrix.png (${box.width * 2}x${box.height * 2}px)`);
}

export async function runCapture(args: string[]) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const onlyReadme = args.includes("--readme");
  const onlyMatrix = args.includes("--matrix");
  const runReadme = onlyReadme || !onlyMatrix;
  const runMatrix = onlyMatrix || !onlyReadme;

  const browserBin = findBrowserExecutable();
  const userDataDir = mkdtempSync(join(tmpdir(), "codexlimit-cdp-"));

  const viteServer = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });

  let browserChild: ReturnType<typeof spawn> | null = null;
  let cdpSession: CdpSession | null = null;

  try {
    await viteServer.listen();
    const address = viteServer.httpServer?.address() as AddressInfo | null;
    if (!address || typeof address.port !== "number") {
      throw new Error("无法获取本地 Vite 预览服务端口");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const launched = await launchHeadlessCdp(browserBin, userDataDir);
    browserChild = launched.child;
    cdpSession = launched.session;

    await cdpSession.send("Page.enable");
    await cdpSession.send("Runtime.enable");
    await cdpSession.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    if (runReadme) {
      await captureReadmeAssets(cdpSession, baseUrl, root);
    }
    if (runMatrix) {
      await captureMatrixOverview(cdpSession, baseUrl, root);
    }
  } finally {
    cdpSession?.close();
    if (browserChild && !browserChild.killed) {
      browserChild.kill();
    }
    await viteServer.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理竞争
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCapture(process.argv.slice(2)).catch((error) => {
    console.error("生成预览图失败：", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
