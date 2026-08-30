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

test("CLI resume relaunches a stopped delegation in the same workspace and hides the stale result while running", async () => {
  const repoRoot = process.cwd();
  const workspaceRoot = createTempDir("fabrica-cli-resume-workspaces-");
  const dataRoot = createTempDir("fabrica-cli-resume-data-");
  const binDir = createTempDir("fabrica-cli-resume-bin-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const logPath = path.join(dataRoot, "workspace-log.txt");
  const fakeOpencode = path.join(binDir, "opencode");

  writeFileSync(
    fakeOpencode,
    ["#!/usr/bin/env bash", "set -euo pipefail", 'printf "%s\n" "$PWD" >> "$WORKSPACE_LOG"'].join(
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
    ["run", "src/index.ts", "create", "--summary", "resume flow"],
    repoRoot,
    env,
  );
  const delegationMatch = createdOutput.match(/Created delegation ([^\n]+)/);
  const workspaceMatch = createdOutput.match(/workspace: (.+)/);
  assert.ok(delegationMatch, createdOutput);
  assert.ok(workspaceMatch, createdOutput);

  const delegationId = delegationMatch?.[1]?.trim();
  const workspacePath = workspaceMatch?.[1]?.trim();
  if (delegationId === undefined || workspacePath === undefined) {
    throw new Error(createdOutput);
  }

  const startOutput = runBun(["run", "src/index.ts", "start", delegationId], repoRoot, env);
  assert.match(startOutput, /status: running/);
  assert.match(startOutput, /provider: opencode/);

  const stopOutput = runBun(["run", "src/index.ts", "stop", delegationId], repoRoot, env);
  assert.match(stopOutput, /status: stopped/);

  const resumeOutput = runBun(["run", "src/index.ts", "resume", delegationId], repoRoot, env);
  assert.match(resumeOutput, /Resumed delegation/);
  assert.match(resumeOutput, /status: running/);
  assert.match(resumeOutput, /provider: opencode/);
  assert.match(
    resumeOutput,
    new RegExp(`workspace: ${workspacePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );

  const logDeadline = Date.now() + 2000;
  let logContents: string[] = [];
  while (Date.now() < logDeadline) {
    if (existsSync(logPath)) {
      const contents = readFileSync(logPath, "utf8").trim();
      if (contents.length > 0) {
        logContents = contents.split(/\r?\n/);
        if (logContents.length >= 2) {
          break;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.deepEqual(logContents, [workspacePath, workspacePath]);

  const registry = new DelegationRegistry(dbPath);
  const record = registry.show(delegationId);
  registry.close();

  assert.ok(record);
  assert.equal(record?.status, "running");
  assert.equal(record?.result, null);
  assert.deepEqual(
    record?.events.map((event) => event.eventType),
    [
      "created",
      "started",
      "preparing",
      "running",
      "stopped",
      "result",
      "resumed",
      "preparing",
      "running",
    ],
  );

  const showOutput = runBun(["run", "src/index.ts", "show", delegationId], repoRoot, env);
  assert.match(showOutput, /status: running/);
  assert.ok(!showOutput.includes("  result:"));
});
