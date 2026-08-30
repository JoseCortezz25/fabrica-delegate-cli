import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("CLI start launches the OpenCode adapter in the isolated workspace and persists events", async () => {
  const repoRoot = process.cwd();
  const workspaceRoot = createTempDir("fabrica-cli-workspaces-");
  const dataRoot = createTempDir("fabrica-cli-data-");
  const binDir = createTempDir("fabrica-cli-bin-");
  const logPath = path.join(dataRoot, "opencode-cwd.txt");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const fakeOpencode = path.join(binDir, "opencode");

  writeFileSync(
    fakeOpencode,
    ["#!/usr/bin/env bash", "set -euo pipefail", 'printf "%s" "$PWD" > "$WORKSPACE_LOG"'].join(
      "\n",
    ),
  );
  chmodSync(fakeOpencode, 0o755);

  const env = {
    ...process.env,
    FABRICA_DELEGATE_DB: dbPath,
    FABRICA_WORKSPACE_ROOT: workspaceRoot,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    WORKSPACE_LOG: logPath,
  };

  const createdOutput = runBun(
    ["run", "src/index.ts", "create", "--summary", "issue 4"],
    repoRoot,
    env,
  );
  const delegationMatch = createdOutput.match(/Created delegation ([^\n]+)/);
  const workspaceMatch = createdOutput.match(/workspace: (.+)/);

  assert.ok(delegationMatch, createdOutput);
  assert.ok(workspaceMatch, createdOutput);

  assert.ok(delegationMatch?.[1]);
  assert.ok(workspaceMatch?.[1]);
  const delegationId = delegationMatch[1].trim();
  const workspacePath = workspaceMatch[1].trim();

  const startOutput = runBun(["run", "src/index.ts", "start", delegationId], repoRoot, env);
  assert.match(startOutput, /status: running/);
  assert.match(startOutput, /provider: opencode/);
  assert.match(startOutput, /pid: \d+/);

  const deadline = Date.now() + 2000;
  while (!existsSync(logPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(readFileSync(logPath, "utf8"), workspacePath);

  const registry = new DelegationRegistry(dbPath);
  const record = registry.show(delegationId);
  registry.close();

  assert.ok(record);
  assert.equal(record?.status, "running");
  assert.deepEqual(
    record?.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running"],
  );
});
