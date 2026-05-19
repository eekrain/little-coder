#!/usr/bin/env node
// little-coder launcher.
// Spawns the bundled pi runtime with our AGENTS.md, skills, and every
// custom extension wired in — works from any working directory.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkForUpdate } from "./update-check.mjs";

// ---- 1. Node version preflight (>= 22.19.0, matching pi.dev) ----
const MIN_NODE = [22, 19, 0];
const cur = process.versions.node.split(".").map((n) => parseInt(n, 10));
const tooOld =
  cur[0] < MIN_NODE[0] ||
  (cur[0] === MIN_NODE[0] && cur[1] < MIN_NODE[1]) ||
  (cur[0] === MIN_NODE[0] && cur[1] === MIN_NODE[1] && cur[2] < MIN_NODE[2]);
if (tooOld) {
  console.error(
    `little-coder requires Node.js >= ${MIN_NODE.join(".")} (you have ${process.versions.node}).\n` +
      `Install a newer Node from https://nodejs.org or via nvm: 'nvm install 22'.`,
  );
  process.exit(1);
}

// ---- 2. Resolve package install root ----
const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

// ---- 3. Resolve the bundled pi CLI entry point ----
// We invoke pi's JS entry directly under the current Node binary instead of
// the `node_modules/.bin/pi` shim. Two reasons:
//   1. On Windows, `.bin/pi.cmd` is an npm-generated batch shim. When it (or
//      anything it transitively invokes) is launched from a path containing
//      spaces — most notably the default Node install location
//      `C:\Program Files\nodejs\` — cmd's whitespace tokenization can split
//      the path at the first space and produce errors like
//      `'C:\Program' is not recognized as an internal or external command`
//      (see issue #23). Spawning `process.execPath` with the resolved cli.js
//      path as an argv element sidesteps cmd entirely — Node's spawn handles
//      Windows argv quoting itself.
//   2. We no longer need a separate `cmd.exe /c …` branch, so the same
//      spawn path works identically on Linux, macOS, and Windows.
const piPkgRoot = join(pkgRoot, "node_modules", "@earendil-works", "pi-coding-agent");
let piEntry;
try {
  const piPkgJson = JSON.parse(readFileSync(join(piPkgRoot, "package.json"), "utf-8"));
  const binRel = typeof piPkgJson?.bin === "string" ? piPkgJson.bin : piPkgJson?.bin?.pi;
  if (typeof binRel !== "string") throw new Error("pi package.json has no bin.pi entry");
  piEntry = resolve(piPkgRoot, binRel);
} catch (err) {
  console.error(
    `little-coder: cannot resolve pi cli entry under ${piPkgRoot}.\n` +
      `Underlying error: ${err?.message ?? err}\n` +
      `Try reinstalling: npm install -g little-coder`,
  );
  process.exit(1);
}
if (!existsSync(piEntry)) {
  console.error(
    `little-coder: cannot find pi at ${piEntry}.\n` +
      `Try reinstalling: npm install -g little-coder`,
  );
  process.exit(1);
}

// ---- 4. Auto-discover bundled extensions ----
const extDir = join(pkgRoot, ".pi", "extensions");
const extArgs = [];
if (existsSync(extDir)) {
  for (const name of readdirSync(extDir).sort()) {
    const subdir = join(extDir, name);
    const idx = join(subdir, "index.ts");
    try {
      if (statSync(subdir).isDirectory() && existsSync(idx)) {
        extArgs.push("--extension", idx);
      }
    } catch {
      // skip unreadable entries
    }
  }
}

// ---- 5. Update check (best-effort, blocks on TTY prompt only) ----
let currentVersion = "0.0.0";
try {
  const pkgJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8"));
  if (typeof pkgJson?.version === "string") currentVersion = pkgJson.version;
} catch {
  // ignore — update-check just won't fire if we can't read the version
}
const exitAfterCheck = await checkForUpdate(currentVersion);
if (exitAfterCheck) {
  // Successful update happened; user needs to re-run the new binary.
  process.exit(0);
}

// ---- 6. Compose pi argv ----
// --no-context-files : ignore the user's AGENTS.md / CLAUDE.md so OURS wins
// --no-extensions    : skip pi's auto-discovery from cwd; explicit -e flags still load
// --system-prompt    : load <pkgRoot>/AGENTS.md regardless of cwd
//
// Strip our own flags before forwarding to pi so it doesn't reject them.
const userArgs = process.argv.slice(2).filter((a) => a !== "--no-update-check");
const agentsMd = join(pkgRoot, "AGENTS.md");
const piArgs = [
  "--no-context-files",
  "--no-extensions",
  ...(existsSync(agentsMd) ? ["--system-prompt", agentsMd] : []),
  ...extArgs,
  ...userArgs,
];

// ---- 7. Suppress pi's own version-banner by default ----
// pi is an internal dependency here; users install `little-coder` and shouldn't
// see in-session nags about updating the underlying coding-agent package.
// PI_SKIP_VERSION_CHECK is the surgical pi switch (interactive-mode.js:525)
// that gates the "Update Available" banner without touching pi's other
// network-dependent startup paths. Honor an explicit user value (set to "0" or
// anything else to re-enable the banner; PI_OFFLINE=1 also re-overrides).
if (process.env.PI_SKIP_VERSION_CHECK === undefined) {
  process.env.PI_SKIP_VERSION_CHECK = "1";
}

// ---- 8. Force pi's global quietStartup so the loaded-resources block stays hidden ----
// Pi's interactive mode dumps an [Extensions] / [Skills] / [Prompts] block on
// every launch unless `quietStartup: true` is set in its global settings
// (~/.pi/agent/settings.json). Our shipped .pi/settings.json doesn't reach pi
// because pi reads from <cwd>/.pi/settings.json (project) or <agentDir>/settings.json
// (global), neither of which is our npm-installed package dir. So the launcher
// non-destructively merges quietStartup: true into the user's actual global
// settings file. Existing keys are preserved. To see the full inventory, run
// `little-coder --verbose` — pi's verbose flag overrides quietStartup.
try {
  const agentDirEnv = process.env.PI_CODING_AGENT_DIR;
  let agentDir;
  if (agentDirEnv && agentDirEnv.trim().length > 0) {
    agentDir = agentDirEnv === "~"
      ? homedir()
      : agentDirEnv.startsWith("~/")
        ? homedir() + agentDirEnv.slice(1)
        : agentDirEnv;
  } else {
    agentDir = join(homedir(), ".pi", "agent");
  }
  mkdirSync(agentDir, { recursive: true });
  const globalSettingsPath = join(agentDir, "settings.json");
  let globalSettings = {};
  if (existsSync(globalSettingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(globalSettingsPath, "utf-8"));
      if (parsed && typeof parsed === "object") globalSettings = parsed;
    } catch {
      // Corrupted JSON — start fresh rather than throw. Pi would have rejected it too.
      globalSettings = {};
    }
  }
  if (globalSettings.quietStartup !== true) {
    globalSettings.quietStartup = true;
    writeFileSync(globalSettingsPath, JSON.stringify(globalSettings, null, 2));
  }
} catch {
  // Best-effort. If we can't write the settings (read-only HOME, etc.) pi
  // falls back to its built-in defaults — the [Extensions] block will show
  // but everything else still works.
}

// ---- 9. Spawn pi in the user's cwd ----
// `process.execPath` is the same Node binary that's running this launcher, so
// pi inherits the exact runtime that already passed our >= 22.19.0 preflight.
// Passing piEntry as an argv element (not a shell string) avoids any
// shell-injection / space-in-path classes on every platform.
const child = spawn(process.execPath, [piEntry, ...piArgs], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

const forward = (sig) => () => {
  try {
    child.kill(sig);
  } catch {
    // child already gone
  }
};
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
process.on("SIGHUP", forward("SIGHUP"));

child.on("error", (err) => {
  console.error("little-coder: failed to start pi:", err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
