import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const nextCli = path.join(frontendRoot, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(
  frontendRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const python =
  process.env.PYTHON ??
  path.join(
    repoRoot,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
const childEnv = {
  ...process.env,
  NEXT_PUBLIC_API_MODE: "real",
  BACKEND_URL: "http://127.0.0.1:8101",
};

if (!fs.existsSync(python)) {
  throw new Error(`找不到后端虚拟环境 Python：${python}`);
}

const build = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: frontendRoot,
  env: childEnv,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const backend = spawn(python, ["tests/integration/qa_fixture_server.py"], {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
});
const frontend = spawn(process.execPath, [nextCli, "start", "-p", "3100"], {
  cwd: frontendRoot,
  env: childEnv,
  stdio: "inherit",
});

let stopped = false;
function stopProcess(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}
function stopServers() {
  if (stopped) return;
  stopped = true;
  stopProcess(frontend);
  stopProcess(backend);
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} 提前退出（code ${child.exitCode}）`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 ${label} 启动超时`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopServers();
    process.exit(130);
  });
}

try {
  await waitFor("http://127.0.0.1:8101/openapi.json", backend, "FastAPI fixture");
  await waitFor("http://127.0.0.1:3100/qa", frontend, "Next.js");
  const runner = spawn(
    process.execPath,
    [playwrightCli, "test", "e2e/real-api.spec.ts"],
    { cwd: frontendRoot, env: childEnv, stdio: "inherit" },
  );
  const exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopServers();
}

process.exit(process.exitCode ?? 0);
