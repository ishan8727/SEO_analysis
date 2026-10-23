// Starts everything for local dev in one terminal. `pnpm start:app`
//   1. helper services (postgres, redis, moli) in Podman or Docker, waiting until they are up
//   2. database migrations (`prisma migrate deploy`, safe to run every time)
//   3. the website (`pnpm dev`) and the worker (`pnpm worker:dev`) side by side
// Ctrl+C stops the website and worker. The helper services keep running (`podman compose stop`).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const isWindows = process.platform === "win32";
const COMPOSE = "compose -f docker-compose.yml -f docker-compose.dev.yml";

function run(command: string): boolean {
  console.log(`> ${command}`);
  return spawnSync(command, { stdio: "inherit", shell: true }).status === 0;
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

// 1. Helper services. On Windows/macOS Podman needs its VM, so start it once if compose fails.
const cli = spawnSync("podman", ["--version"], { stdio: "ignore" }).status === 0 ? "podman" : "docker";
const servicesUp = `${cli} ${COMPOSE} up -d --wait postgres redis moli`;
if (!run(servicesUp)) {
  const recovered = cli === "podman" && run("podman machine start") && run(servicesUp);
  if (!recovered) fail(`Could not start the helper services. Is ${cli} running?`);
}

// 2. Migrations.
if (!run("pnpm prisma migrate deploy")) fail("Database migrations failed (see above).");

// 3. Website and worker, each line prefixed with its name.
function start(name: string, command: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(command, {
    shell: true,
    detached: !isWindows, // own process group, so stop() can end pnpm and everything under it
    env: { ...process.env, FORCE_COLOR: "1", ...env },
  });
  const prefix = `[${name}]`.padEnd(9);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream! }).on("line", (line) => console.log(`${prefix} ${line}`));
  }
  child.on("exit", (code) => {
    console.log(`${prefix} exited (${code ?? "signal"})`);
    shutdown(code ?? 1);
  });
  return child;
}

function stop(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-child.pid, "SIGTERM");
}

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  children.forEach(stop);
  process.exit(code);
}

const children = [
  start("web", "pnpm dev"),
  start("worker", "pnpm worker:dev", { SERVICE_NAME: "worker" }),
];
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
