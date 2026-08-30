import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

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

test(
  "CLI attach reports a capability-gated no-op when the provider cannot attach",
  { timeout: 15000 },
  async () => {
    const repoRoot = process.cwd();
    const workspaceRoot = createTempDir("fabrica-cli-workspaces-");
    const dataRoot = createTempDir("fabrica-cli-data-");
    const binDir = createTempDir("fabrica-cli-bin-");
    const logPath = path.join(dataRoot, "opencode-cwd.txt");
    const dbPath = path.join(dataRoot, "delegations.sqlite3");
    const fakeCommand = path.join(binDir, "opencode");

    writeFileSync(
      fakeCommand,
      ["#!/usr/bin/env bash", "set -euo pipefail", 'printf "%s" "$PWD" > "$WORKSPACE_LOG"'].join(
        "\n",
      ),
    );
    chmodSync(fakeCommand, 0o755);

    const env = {
      ...process.env,
      FABRICA_DELEGATE_DB: dbPath,
      FABRICA_WORKSPACE_ROOT: workspaceRoot,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      WORKSPACE_LOG: logPath,
    };

    const createdOutput = runBun(
      ["run", "src/index.ts", "create", "--provider", "opencode", "--summary", "issue 9"],
      repoRoot,
      env,
    );
    const delegationMatch = createdOutput.match(/Created delegation ([^\n]+)/);
    if (delegationMatch === null || delegationMatch[1] === undefined) {
      throw new Error(createdOutput);
    }

    const delegationId = delegationMatch[1].trim();
    runBun(["run", "src/index.ts", "start", delegationId], repoRoot, env);

    const deadline = Date.now() + 2000;
    while (!existsSync(logPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(readFileSync(logPath, "utf8"), path.join(workspaceRoot, delegationId));

    const attachOutput = runBun(["run", "src/index.ts", "attach", delegationId], repoRoot, env);
    assert.match(attachOutput, /Provider opencode does not support attach/);
    assert.match(attachOutput, /status: running/);
  },
);
