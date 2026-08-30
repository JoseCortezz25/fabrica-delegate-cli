import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationService } from "../src/delegation-service.js";
import { OpenCodeAdapter } from "../src/opencode-adapter.js";
import type {
  DelegationLaunchContext,
  DelegationLaunchResult,
  DelegationProviderAdapter,
} from "../src/provider-adapters.js";
import { DelegationRegistry } from "../src/registry.js";
import { WorkspaceManager } from "../src/workspace-manager.js";

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

function runBunExpectFailure(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): {
  stdout: string;
  stderr: string;
} {
  try {
    runBun(args, cwd, env);
    throw new Error(`expected command to fail: bun ${args.join(" ")}`);
  } catch (error) {
    if (error instanceof Error && "stdout" in error && "stderr" in error) {
      return {
        stdout: String((error as { stdout?: string }).stdout ?? ""),
        stderr: String((error as { stderr?: string }).stderr ?? ""),
      };
    }

    throw error;
  }
}

function createGitRepo(): { repoRoot: string; workspaceRoot: string; registryPath: string } {
  const root = createTempDir("fabrica-worktree-");
  const workspaceRoot = createTempDir("fabrica-workspaces-");
  const registryPath = path.join(root, "registry.sqlite3");

  execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "pipe" });
  writeFileSync(path.join(root, "README.md"), "initial workspace repo\n");
  execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: root, stdio: "pipe" });

  return { repoRoot: root, workspaceRoot, registryPath };
}

class RecordingAdapter implements DelegationProviderAdapter {
  public lastContext: DelegationLaunchContext | null = null;

  constructor(
    readonly provider: string,
    private readonly command: string,
  ) {}

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    this.lastContext = context;
    return {
      provider: this.provider,
      command: this.command,
      args: ["--headless"],
      pid: 4242,
      workspaceReference: context.workspaceReference,
      startedAt: new Date().toISOString(),
    };
  }
}

class LiveProcessAdapter implements DelegationProviderAdapter {
  readonly provider = "opencode";

  constructor(
    private readonly command: string,
    private readonly env: Record<string, string>,
  ) {}

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    return await new Promise<DelegationLaunchResult>((resolve, reject) => {
      const proc = spawn(this.command, [], {
        cwd: context.workspaceReference,
        detached: true,
        env: {
          ...process.env,
          ...this.env,
        },
        stdio: "ignore",
      });

      proc.once("error", reject);
      proc.once("spawn", () => {
        if (proc.pid == null) {
          reject(new Error("expected provider process pid"));
          return;
        }

        proc.unref();
        resolve({
          provider: this.provider,
          command: this.command,
          args: [],
          pid: proc.pid,
          workspaceReference: context.workspaceReference,
          startedAt: new Date().toISOString(),
        });
      });
    });
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("adapter spawn failures mark the delegation failed", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    {
      adapters: [new OpenCodeAdapter({ command: "definitely-not-a-real-command-42" })],
    },
  );

  const created = service.createDelegation({ summary: "spawn failure", provider: "opencode" });

  await assert.rejects(
    service.startDelegation(created.delegationId),
    /Executable not found in \$PATH|ENOENT/i,
  );

  const shown = registry.show(created.delegationId);
  assert.ok(shown);
  assert.equal(shown?.status, "failed");
  assert.deepEqual(
    shown?.events.map((event) => event.eventType),
    ["created", "started", "preparing", "failed"],
  );

  registry.close();
});

test("unknown providers fail start, resume, and fan-out with a clear adapter error", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [new RecordingAdapter("opencode", "fake-opencode")] },
  );

  const missingStart = service.createDelegation({ summary: "missing provider", provider: "ghost" });
  await assert.rejects(
    service.startDelegation(missingStart.delegationId),
    /No provider adapter registered for ghost/,
  );
  assert.equal(
    registry
      .show(missingStart.delegationId)
      ?.events.map((event) => event.eventType)
      .join(","),
    "created",
  );

  const existingWorkspace = createTempDir("fabrica-existing-workspace-");
  const resumable = registry.create({
    identity: "factory-agent",
    status: "stopped",
    scope: "repository",
    provider: "ghost",
    workspaceReference: existingWorkspace,
    summary: "resume with missing provider",
    metadata: {},
  });

  await assert.rejects(
    service.resumeDelegation(resumable.delegationId),
    /No provider adapter registered for ghost/,
  );
  assert.deepEqual(
    registry.show(resumable.delegationId)?.events.map((event) => event.eventType),
    ["created"],
  );

  await assert.rejects(
    service.fanOutDelegations({
      summary: "fan-out missing provider",
      providers: ["opencode", "ghost"],
    }),
    /No provider adapter registered for ghost/,
  );

  registry.close();
});

test("resume rejects delegations that are not stopped or failed", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [new RecordingAdapter("opencode", "fake-opencode")] },
  );

  const created = service.createDelegation({
    summary: "resume precondition",
    provider: "opencode",
  });

  await assert.rejects(
    service.resumeDelegation(created.delegationId),
    /is not resumable from status queued/,
  );

  registry.close();
});

test("attach rejects non-running delegations and returns a no-attach response when unsupported", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [new RecordingAdapter("opencode", "fake-opencode")] },
  );

  const queued = service.createDelegation({ summary: "attach precondition", provider: "opencode" });
  await assert.rejects(service.attachDelegation(queued.delegationId), /is not running/);

  const noAttachAdapter = new RecordingAdapter("opencode", "fake-opencode");
  const noAttachService = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [noAttachAdapter] },
  );
  const running = noAttachService.createDelegation({ summary: "no attach", provider: "opencode" });
  await noAttachService.startDelegation(running.delegationId);
  const attached = await noAttachService.attachDelegation(running.delegationId);
  assert.equal(attached.attached, false);
  assert.match(attached.message, /does not support attach/);

  registry.close();
});

test("stop records the live PID path and remains idempotent when no PID is tracked", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const dataRoot = createTempDir("fabrica-stop-live-");
  const binDir = createTempDir("fabrica-stop-bin-");
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

  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    {
      adapters: [
        new LiveProcessAdapter(fakeOpencode, {
          START_FILE: startedPath,
          STOP_FILE: stoppedPath,
        }),
      ],
    },
  );

  const created = service.createDelegation({ summary: "stop live pid", provider: "opencode" });
  const started = await service.startDelegation(created.delegationId);
  assert.equal(started.record.status, "running");
  assert.ok(started.launch.pid > 0);

  const startedDeadline = Date.now() + 2000;
  while (!existsSync(startedPath) && Date.now() < startedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(readFileSync(startedPath, "utf8"), "started");

  const stopped = await service.stopDelegation(created.delegationId);
  assert.equal(stopped.pid, started.launch.pid);
  assert.equal(stopped.record.status, "stopped");
  assert.equal(stopped.record.result?.exitCode, 143);

  const stopDeadline = Date.now() + 2000;
  while (!existsSync(stoppedPath) && Date.now() < stopDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(readFileSync(stoppedPath, "utf8"), "stopped");

  const stoppedAgain = await service.stopDelegation(created.delegationId);
  assert.equal(stoppedAgain.pid, started.launch.pid);
  assert.equal(stoppedAgain.record.result?.exitCode, 143);
  assert.deepEqual(
    stoppedAgain.record.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running", "stopped", "result"],
  );

  registry.close();
});

test("stop normalizes missing and malformed artifacts", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [new RecordingAdapter("opencode", "fake-opencode")] },
  );

  const missing = service.createDelegation({
    summary: "missing artifacts",
    provider: "opencode",
    metadata: { ticket: "#42" },
  });
  const missingStopped = await service.stopDelegation(missing.delegationId);
  assert.deepEqual(missingStopped.record.result?.artifacts, []);

  const malformed = service.createDelegation({
    summary: "malformed artifacts",
    provider: "opencode",
    metadata: {
      artifacts: [
        null,
        5,
        {},
        { path: "" },
        { path: "docs/summary.md", kind: "file", description: "summary" },
        { path: "docs/notes.md", description: "" },
      ],
    },
  });
  const malformedStopped = await service.stopDelegation(malformed.delegationId);
  assert.deepEqual(malformedStopped.record.result?.artifacts, [
    { path: "docs/summary.md", kind: "file", description: "summary" },
    { path: "docs/notes.md" },
  ]);

  registry.close();
});

test("CLI reports invalid metadata JSON, missing delegations, and invalid fan-out arity", () => {
  const repoRoot = process.cwd();
  const dataRoot = createTempDir("fabrica-cli-negative-data-");
  const workspaceRoot = createTempDir("fabrica-cli-negative-workspaces-");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const env = {
    ...process.env,
    FABRICA_DELEGATE_DB: dbPath,
    FABRICA_WORKSPACE_ROOT: workspaceRoot,
  };

  const invalidMetadata = runBunExpectFailure(
    ["run", "src/index.ts", "create", "--summary", "bad metadata", "--metadata", "{"],
    repoRoot,
    env,
  );
  assert.match(invalidMetadata.stderr, /--metadata must be a JSON object/);

  const missingStart = runBunExpectFailure(
    ["run", "src/index.ts", "start", "missing-id"],
    repoRoot,
    env,
  );
  assert.match(missingStart.stderr, /Delegation not found: missing-id/);

  const missingShow = runBunExpectFailure(
    ["run", "src/index.ts", "show", "missing-id"],
    repoRoot,
    env,
  );
  assert.match(missingShow.stderr, /Delegation not found: missing-id/);

  const badFanout = runBunExpectFailure(
    ["run", "src/index.ts", "fanout", "--provider", "opencode", "--summary", "bad fanout"],
    repoRoot,
    env,
  );
  assert.match(
    badFanout.stderr,
    /--provider must be supplied at least twice, or with at least two comma-separated providers/,
  );
});
