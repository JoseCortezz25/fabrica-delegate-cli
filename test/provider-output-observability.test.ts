import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { ClaudeCodeAdapter } from "../src/claude-code-adapter.js";
import { DelegationService } from "../src/delegation-service.js";
import { OpenCodeAdapter } from "../src/opencode-adapter.js";
import { DelegationRegistry } from "../src/registry.js";
import { formatHeadlessSnapshot, type WatchSnapshot } from "../src/watch.js";
import { WorkspaceManager } from "../src/workspace-manager.js";

const tempRoots: string[] = [];
const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function bunBin(): string {
  return path.join(os.homedir(), ".bun", "bin", "bun");
}

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function createGitRepo(): { repoRoot: string; workspaceRoot: string; registryPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "fabrica-output-observability-"));
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "fabrica-output-workspaces-"));
  tempRoots.push(root, workspaceRoot);

  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["config", "user.name", "Test User"]);
  writeFileSync(path.join(root, "README.md"), "initial workspace repo\n");
  runGit(root, ["add", "README.md"]);
  runGit(root, ["commit", "-m", "initial commit"]);

  return {
    repoRoot: root,
    workspaceRoot,
    registryPath: path.join(root, "delegations.sqlite3"),
  };
}

function createFakeProviderScript(prefix: string, outputDir: string): string {
  const scriptPath = path.join(outputDir, `${prefix}-provider`);
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'captured stdout from ${prefix}\\n'`,
      `printf 'captured stderr from ${prefix}\\n' >&2`,
      "sleep 0.2",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitForOutputEvents(
  registry: DelegationRegistry,
  delegationId: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = registry.show(delegationId);
    if (
      record !== null &&
      record.events.some((event) => event.eventType === "provider_stdout") &&
      record.events.some((event) => event.eventType === "provider_stderr")
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`timed out waiting for provider output events on ${delegationId}`);
}

async function runProviderOutputRegressionTest(
  provider: "opencode" | "claude-code",
  adapter: OpenCodeAdapter | ClaudeCodeAdapter,
): Promise<void> {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    provider,
    summary: "capture provider output",
  });

  await service.startDelegation(created.delegationId);
  await waitForOutputEvents(registry, created.delegationId);

  const shown = registry.show(created.delegationId);
  if (shown === null) {
    throw new Error("expected delegation to exist after start");
  }

  assert.ok(
    shown.events.some((event) => event.eventType === "provider_stdout"),
    "expected stdout output event",
  );
  assert.ok(
    shown.events.some((event) => event.eventType === "provider_stderr"),
    "expected stderr output event",
  );
  assert.match(JSON.stringify(shown.events), /captured stdout from/);
  assert.match(JSON.stringify(shown.events), /captured stderr from/);
  const snapshot: WatchSnapshot = {
    record: shown,
    lastEventId: shown.events.at(-1)?.eventId ?? null,
  };
  assert.match(formatHeadlessSnapshot(snapshot).join("\n"), /provider_stdout/);
  assert.match(formatHeadlessSnapshot(snapshot).join("\n"), /provider_stderr/);

  await service.stopDelegation(created.delegationId);

  const watchOutput = execFileSync(
    bunBin(),
    ["run", "src/index.ts", "watch", created.delegationId, "--headless", "--poll-interval", "25"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        FABRICA_DELEGATE_DB: registryPath,
      },
      encoding: "utf8",
    },
  );
  assert.match(watchOutput, /provider_stdout/);
  assert.match(watchOutput, /captured stdout from/);
  assert.match(watchOutput, /provider_stderr/);
  assert.match(watchOutput, /captured stderr from/);

  const resultOutput = execFileSync(
    bunBin(),
    ["run", "src/index.ts", "result", created.delegationId],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        FABRICA_DELEGATE_DB: registryPath,
      },
      encoding: "utf8",
    },
  );
  assert.match(resultOutput, /provider_output:/);
  assert.match(resultOutput, /\[provider_stdout\] captured stdout from/);
  assert.match(resultOutput, /\[provider_stderr\] captured stderr from/);

  registry.close();
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("OpenCodeAdapter captures provider stdout and stderr into the event stream", async () => {
  const binDir = mkdtempSync(path.join(os.tmpdir(), "fabrica-output-bin-"));
  tempRoots.push(binDir);
  const scriptPath = createFakeProviderScript("opencode", binDir);
  await runProviderOutputRegressionTest(
    "opencode",
    new OpenCodeAdapter({ command: scriptPath }),
  );
});

test("ClaudeCodeAdapter captures provider stdout and stderr into the event stream", async () => {
  const binDir = mkdtempSync(path.join(os.tmpdir(), "fabrica-output-bin-"));
  tempRoots.push(binDir);
  const scriptPath = createFakeProviderScript("claude", binDir);
  await runProviderOutputRegressionTest(
    "claude-code",
    new ClaudeCodeAdapter({ command: scriptPath }),
  );
});
