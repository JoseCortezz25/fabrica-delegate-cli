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

test("CLI fan-out starts the same task across multiple providers and prints a comparison table", async () => {
  const repoRoot = process.cwd();
  const workspaceRoot = createTempDir("fabrica-cli-workspaces-");
  const dataRoot = createTempDir("fabrica-cli-data-");
  const binDir = createTempDir("fabrica-cli-bin-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const opencodeLog = path.join(dataRoot, "opencode-cwd.txt");
  const claudeLog = path.join(dataRoot, "claude-code-cwd.txt");
  const opencodeCommand = path.join(binDir, "opencode");
  const claudeCommand = path.join(binDir, "claude");

  writeFileSync(
    opencodeCommand,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s|%s" "$PWD" "$*" > "$OPENCODE_LOG"',
    ].join("\n"),
  );
  writeFileSync(
    claudeCommand,
    ["#!/usr/bin/env bash", "set -euo pipefail", 'printf "%s|%s" "$PWD" "$*" > "$CLAUDE_LOG"'].join(
      "\n",
    ),
  );
  chmodSync(opencodeCommand, 0o755);
  chmodSync(claudeCommand, 0o755);

  const env = {
    ...process.env,
    CLAUDE_LOG: claudeLog,
    FABRICA_DELEGATE_DB: dbPath,
    FABRICA_WORKSPACE_ROOT: workspaceRoot,
    OPENCODE_LOG: opencodeLog,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };

  const output = runBun(
    [
      "run",
      "src/index.ts",
      "fanout",
      "--provider",
      "opencode",
      "--provider",
      "claude-code",
      "--summary",
      "issue 12",
    ],
    repoRoot,
    env,
  );

  assert.match(output, /Fan-out group/);
  assert.match(output, /provider/);
  assert.match(output, /delegation_id/);
  assert.match(output, /opencode/);
  assert.match(output, /claude-code/);
  assert.match(output, /opencode.*run issue 12/);
  assert.match(output, /claude-code.*-p issue 12/);

  const deadline = Date.now() + 2000;
  while ((!existsSync(opencodeLog) || !existsSync(claudeLog)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const registry = new DelegationRegistry(dbPath);
  const records = registry.list();
  registry.close();

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.provider).sort(), ["claude-code", "opencode"]);
  assert.deepEqual(
    records.map((record) => record.status),
    ["running", "running"],
  );

  const recordsByProvider = new Map(records.map((record) => [record.provider, record] as const));
  assert.equal(
    readFileSync(opencodeLog, "utf8"),
    `${recordsByProvider.get("opencode")?.workspaceReference}|run issue 12`,
  );
  assert.equal(
    readFileSync(claudeLog, "utf8"),
    `${recordsByProvider.get("claude-code")?.workspaceReference}|-p issue 12`,
  );
});
