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

async function runProviderStartTest(options: {
  provider: string;
  commandName: string;
  logFileName: string;
  summary: string;
}): Promise<void> {
  const repoRoot = process.cwd();
  const workspaceRoot = createTempDir("fabrica-cli-workspaces-");
  const dataRoot = createTempDir("fabrica-cli-data-");
  const binDir = createTempDir("fabrica-cli-bin-");
  const logPath = path.join(dataRoot, options.logFileName);
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const fakeCommand = path.join(binDir, options.commandName);

  writeFileSync(
    fakeCommand,
    [
      "#!/usr/bin/env python3",
      "import json",
      "import os",
      "import pathlib",
      "import sys",
      'pathlib.Path(os.environ["WORKSPACE_LOG"]).write_text(',
      '    json.dumps({"cwd": os.getcwd(), "argv": sys.argv[1:]})',
      ")",
    ].join("\n"),
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
    ["run", "src/index.ts", "create", "--provider", options.provider, "--summary", options.summary],
    repoRoot,
    env,
  );
  const delegationMatch = createdOutput.match(/Created delegation ([^\n]+)/);
  const workspaceMatch = createdOutput.match(/workspace: (.+)/);

  if (delegationMatch === null || delegationMatch[1] === undefined) {
    throw new Error(createdOutput);
  }
  if (workspaceMatch === null || workspaceMatch[1] === undefined) {
    throw new Error(createdOutput);
  }

  const delegationId = delegationMatch[1].trim();
  const workspacePath = workspaceMatch[1].trim();

  const startOutput = runBun(["run", "src/index.ts", "start", delegationId], repoRoot, env);
  assert.match(startOutput, /status: running/);
  assert.ok(startOutput.includes(`provider: ${options.provider}`), startOutput);
  assert.match(startOutput, /pid: \d+/);
  assert.match(
    startOutput,
    new RegExp(
      `command: .*${options.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );

  const deadline = Date.now() + 2000;
  while (!existsSync(logPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const invocation = JSON.parse(readFileSync(logPath, "utf8")) as {
    argv: string[];
    cwd: string;
  };

  assert.equal(invocation.cwd, workspacePath);
  assert.deepEqual(
    invocation.argv,
    options.provider === "opencode" ? ["run", options.summary] : ["-p", options.summary],
  );

  const registry = new DelegationRegistry(dbPath);
  const record = registry.show(delegationId);
  registry.close();

  assert.ok(record);
  assert.equal(record?.status, "running");
  assert.deepEqual(
    record?.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running"],
  );
}

test(
  "CLI start launches the OpenCode adapter in the isolated workspace and persists events",
  { timeout: 15000 },
  async () => {
    await runProviderStartTest({
      provider: "opencode",
      commandName: "opencode",
      logFileName: "opencode-cwd.txt",
      summary: "issue 4",
    });
  },
);

test(
  "CLI start launches the Claude Code adapter in the isolated workspace and persists events",
  { timeout: 15000 },
  async () => {
    await runProviderStartTest({
      provider: "claude-code",
      commandName: "claude",
      logFileName: "claude-code-cwd.txt",
      summary: "issue 8",
    });
  },
);
