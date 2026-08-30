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

test("CLI result and show expose the final outcome and artifact locations", () => {
  const repoRoot = process.cwd();
  const dataRoot = createTempDir("fabrica-cli-result-data-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const workspaceRoot = path.join(dataRoot, "workspaces");
  const registry = new DelegationRegistry(dbPath);

  const created = registry.create({
    identity: "factory-agent",
    status: "completed",
    scope: "repository",
    provider: "opencode",
    workspaceReference: path.join(workspaceRoot, "delegation-7"),
    summary: "final result demo",
    metadata: {
      ticket: "#7",
      artifacts: [
        {
          path: path.join(workspaceRoot, "delegation-7", "artifacts", "final-summary.md"),
          kind: "file",
          description: "final summary markdown",
        },
      ],
    },
  });

  registry.recordFinalResult(created.delegationId, {
    exitCode: 0,
    status: "completed",
    summary: created.summary,
    metadata: created.metadata,
    artifacts: [
      {
        path: path.join(workspaceRoot, "delegation-7", "artifacts", "final-summary.md"),
        kind: "file",
        description: "final summary markdown",
      },
    ],
  });
  registry.close();

  const env = {
    ...process.env,
    FABRICA_DELEGATE_DB: dbPath,
  };

  const showOutput = runBun(["run", "src/index.ts", "show", created.delegationId], repoRoot, env);
  assert.match(showOutput, /result:/);
  assert.match(showOutput, /exit_code: 0/);
  assert.match(showOutput, /final summary markdown/);
  assert.match(showOutput, /workspace:/);

  const resultOutput = runBun(
    ["run", "src/index.ts", "result", created.delegationId],
    repoRoot,
    env,
  );
  assert.match(resultOutput, /final result/);
  assert.match(resultOutput, /exit_code: 0/);
  assert.match(resultOutput, /final-summary\.md/);
});

test("CLI stop terminates a running provider and persists stopped state", async () => {
  const repoRoot = process.cwd();
  const workspaceRoot = createTempDir("fabrica-cli-workspaces-");
  const dataRoot = createTempDir("fabrica-cli-stop-data-");
  const binDir = createTempDir("fabrica-cli-stop-bin-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const startedPath = path.join(dataRoot, "provider-started.txt");
  const stoppedPath = path.join(dataRoot, "provider-stopped.txt");
  const fakeOpencode = path.join(binDir, "opencode");

  writeFileSync(
    fakeOpencode,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "trap 'printf stopped > \"$STOP_FILE\"; exit 0' TERM",
      'printf started > "$START_FILE"',
      "while true; do sleep 1; done",
    ].join("\n"),
  );
  chmodSync(fakeOpencode, 0o755);

  const env = {
    ...process.env,
    FABRICA_DELEGATE_DB: dbPath,
    FABRICA_WORKSPACE_ROOT: workspaceRoot,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    START_FILE: startedPath,
    STOP_FILE: stoppedPath,
  };

  const createdOutput = runBun(
    ["run", "src/index.ts", "create", "--summary", "stop flow"],
    repoRoot,
    env,
  );
  const delegationMatch = createdOutput.match(/Created delegation ([^\n]+)/);
  assert.ok(delegationMatch, createdOutput);
  const delegationId = delegationMatch?.[1];
  if (delegationId === undefined) {
    throw new Error("expected delegation id in create output");
  }

  const startOutput = runBun(["run", "src/index.ts", "start", delegationId], repoRoot, env);
  assert.match(startOutput, /status: running/);
  assert.match(startOutput, /provider: opencode/);

  const startedDeadline = Date.now() + 2000;
  while (!existsSync(startedPath) && Date.now() < startedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(readFileSync(startedPath, "utf8"), "started");

  const stopOutput = runBun(["run", "src/index.ts", "stop", delegationId], repoRoot, env);
  assert.match(stopOutput, /status: stopped/);

  const stoppedDeadline = Date.now() + 2000;
  while (!existsSync(stoppedPath) && Date.now() < stoppedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(readFileSync(stoppedPath, "utf8"), "stopped");

  const registry = new DelegationRegistry(dbPath);
  const record = registry.show(delegationId);
  registry.close();

  assert.ok(record);
  assert.equal(record?.status, "stopped");
  assert.deepEqual(
    record?.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running", "stopped", "result"],
  );
  assert.equal(record?.result?.exitCode, 143);
});
