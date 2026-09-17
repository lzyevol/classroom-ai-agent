import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const server = spawn(process.execPath, [nextCli, "start", "-p", "3100"], {
  cwd: root,
  detached: process.platform !== "win32",
  stdio: "inherit",
});

let stopped = false;

function stopServer() {
  if (stopped || !server.pid) return;
  stopped = true;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The server may already have exited.
    }
  }
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js 服务提前退出（code ${server.exitCode}）`);
    }
    try {
      const response = await fetch("http://127.0.0.1:3100");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("等待 Next.js 服务启动超时");
}

const handledSignals = ["SIGINT", "SIGTERM"];
function handleSignal() {
  stopServer();
  process.exit(130);
}
for (const signal of handledSignals) {
  process.once(signal, handleSignal);
}

try {
  await waitForServer();
  const runner = spawn(process.execPath, [
    playwrightCli,
    "test",
    "e2e/core-flows.spec.ts",
    "e2e/error-flows.spec.ts",
    ...process.argv.slice(2),
  ], {
    cwd: root,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopServer();
  for (const signal of handledSignals) {
    process.removeListener(signal, handleSignal);
  }
}

process.exit(process.exitCode ?? 0);
