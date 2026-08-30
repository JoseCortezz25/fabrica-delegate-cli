import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationRegistry } from "../src/registry.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runBun(args: string[], cwd: string, env: Record<string, string | undefined>): string {
  return execFileSync(path.join(os.homedir(), ".bun", "bin", "bun"), args, {
    cwd,
    env,
    encoding: "utf8",
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("CLI replay reconstructs the persisted event stream with transitions and commands", () => {
  const repoRoot = process.cwd();
  const dataRoot = createTempDir("fabrica-replay-data-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const workspaceRoot = createTempDir("fabrica-replay-workspaces-");
  const registry = new DelegationRegistry(dbPath);

  const created = registry.create({
    identity: "factory-agent",
    status: "queued",
    scope: "repository",
    provider: "opencode",
    workspaceReference: "/tmp/fabrica-replay-workspace",
    summary: "replay issue #11",
    metadata: { issue: 11 },
  });

  registry.updateWorkspaceReference(created.delegationId, workspaceRoot);
  registry.recordLifecycleEvent(created.delegationId, "started", "started", {
    delegationId: created.delegationId,
    workspaceReference: workspaceRoot,
    summary: "replay issue #11",
    metadata: { issue: 11 },
    previousStatus: "queued",
  });
  registry.recordLifecycleEvent(created.delegationId, "preparing", "preparing", {
    delegationId: created.delegationId,
    workspaceReference: workspaceRoot,
    summary: "replay issue #11",
    metadata: { issue: 11 },
    previousStatus: "started",
  });
  registry.recordLifecycleEvent(created.delegationId, "running", "running", {
    delegationId: created.delegationId,
    workspaceReference: workspaceRoot,
    summary: "replay issue #11",
    metadata: { issue: 11 },
    previousStatus: "preparing",
    pid: 4242,
    provider: "opencode",
    command: "opencode",
    args: ["--issue", "11"],
    launchedAt: "2026-08-30T00:00:05.000Z",
  });
  registry.recordLifecycleEvent(created.delegationId, "stopped", "stopped", {
    delegationId: created.delegationId,
    workspaceReference: workspaceRoot,
    summary: "replay issue #11",
    metadata: { issue: 11 },
    previousStatus: "running",
    pid: 4242,
    signal: "SIGTERM",
  });
  registry.recordFinalResult(created.delegationId, {
    exitCode: 0,
    status: "stopped",
    summary: "replay issue #11 complete",
    metadata: { issue: 11 },
    artifacts: [{ path: "replay.log", kind: "log" }],
    sourceEventType: "result",
  });
  registry.close();

  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  sqlite.query("DELETE FROM delegations WHERE delegation_id = ?;").run(created.delegationId);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.close();

  const output = runBun(["run", "src/index.ts", "replay", created.delegationId], repoRoot, {
    ...process.env,
    FABRICA_DELEGATE_DB: dbPath,
    FABRICA_WORKSPACE_ROOT: workspaceRoot,
  });

  assert.match(output, new RegExp(`Replay delegation ${created.delegationId}`));
  assert.match(output, /Events: 7/);
  assert.match(output, /state: \(none\) -> queued/);
  assert.match(output, /state: queued -> started/);
  assert.match(output, /state: preparing -> running/);
  assert.match(output, /command: "opencode"/);
  assert.match(output, /args: \["--issue", "11"\]/);
  assert.match(output, /state: running -> stopped/);
  assert.match(output, /exit_code: 0/);
});
