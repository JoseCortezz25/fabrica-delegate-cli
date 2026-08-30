import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { ClaudeCodeAdapter } from "../src/claude-code-adapter.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("ClaudeCodeAdapter launches the command inside the workspace", async () => {
  const workspace = createTempDir("fabrica-claude-workspace-");
  const binDir = createTempDir("fabrica-claude-bin-");
  const logPath = path.join(binDir, "cwd.txt");
  const scriptPath = path.join(binDir, "claude");

  writeFileSync(
    scriptPath,
    ["#!/usr/bin/env bash", "set -euo pipefail", 'printf "%s" "$PWD" > "$WORKSPACE_LOG"'].join(
      "\n",
    ),
  );
  chmodSync(scriptPath, 0o755);

  const adapter = new ClaudeCodeAdapter({
    command: scriptPath,
    env: { WORKSPACE_LOG: logPath },
  });

  const launch = await adapter.start({
    delegationId: "delegation-8",
    workspaceReference: workspace,
    summary: "test delegation",
    metadata: {},
  });

  assert.equal(launch.provider, "claude-code");
  assert.equal(launch.command, scriptPath);
  assert.ok(launch.pid > 0);

  const deadline = Date.now() + 2000;
  while (!existsSync(logPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(readFileSync(logPath, "utf8"), workspace);
});
