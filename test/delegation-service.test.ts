import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationService } from "../src/delegation-service.js";
import type {
  DelegationAttachContext,
  DelegationLaunchContext,
  DelegationLaunchResult,
  DelegationProviderAdapter,
} from "../src/provider-adapters.js";
import { DelegationRegistry } from "../src/registry.js";
import { WorkspaceManager } from "../src/workspace-manager.js";

const tempRoots: string[] = [];

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function createGitRepo(): { repoRoot: string; workspaceRoot: string; registryPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "fabrica-worktree-"));
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "fabrica-workspaces-"));
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
    registryPath: path.join(root, "registry.sqlite3"),
  };
}

class RecordingAdapter implements DelegationProviderAdapter {
  constructor(
    readonly provider: string,
    private readonly commandName: string,
  ) {}
  public lastContext: DelegationLaunchContext | null = null;

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    this.lastContext = context;
    return {
      provider: this.provider,
      command: this.commandName,
      args: ["--headless"],
      pid: 4242,
      workspaceReference: context.workspaceReference,
      startedAt: new Date().toISOString(),
    };
  }
}

class AttachRecordingAdapter extends RecordingAdapter {
  public lastAttachContext: DelegationAttachContext | null = null;

  async attach(context: DelegationAttachContext): Promise<void> {
    this.lastAttachContext = context;
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
      const child = spawn(this.command, [], {
        cwd: context.workspaceReference,
        detached: true,
        env: {
          ...process.env,
          ...this.env,
        },
        stdio: "ignore",
      });

      child.once("error", reject);
      child.once("spawn", () => {
        if (child.pid == null) {
          reject(new Error("expected provider process pid"));
          return;
        }

        child.unref();
        resolve({
          provider: this.provider,
          command: this.command,
          args: [],
          pid: child.pid,
          workspaceReference: context.workspaceReference,
          startedAt: new Date().toISOString(),
        });
      });
    });
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

async function runStartLifecycleTest(provider: string, commandName: string): Promise<void> {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const adapter = new RecordingAdapter(provider, commandName);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    summary: "launch me",
    provider,
  });

  const started = await service.startDelegation(created.delegationId);

  assert.equal(started.record.status, "running");
  assert.equal(started.record.provider, provider);
  assert.equal(adapter.lastContext?.workspaceReference, created.workspaceReference);
  assert.equal(adapter.lastContext?.delegationId, created.delegationId);
  assert.equal(adapter.lastContext?.summary, "launch me");
  assert.equal(existsSync(created.workspaceReference), true);

  const shown = registry.show(created.delegationId);
  if (shown === null) {
    throw new Error("expected delegation to exist after start");
  }

  assert.deepEqual(
    shown.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running"],
  );
  assert.equal(shown.status, "running");
  assert.equal(shown.events.at(-1)?.payload.pid, 4242);

  registry.close();
}

test("start records lifecycle events and launches the adapter in the isolated workspace", async () => {
  await runStartLifecycleTest("opencode", "fake-opencode");
});

test("start can dispatch the Claude Code adapter through the same lifecycle", async () => {
  await runStartLifecycleTest("claude-code", "fake-claude");
});

test("stop records stopped even when no provider pid is tracked and is idempotent", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [new RecordingAdapter("opencode", "fake-opencode")] },
  );

  const created = service.createDelegation({
    summary: "stop me without a running process",
    provider: "opencode",
  });

  const stopped = await service.stopDelegation(created.delegationId);
  assert.equal(stopped.record.status, "stopped");
  assert.equal(stopped.pid, null);

  const stoppedAgain = await service.stopDelegation(created.delegationId);
  assert.equal(stoppedAgain.record.status, "stopped");
  assert.equal(stoppedAgain.pid, null);
  assert.deepEqual(
    stoppedAgain.record.events.map((event) => event.eventType),
    ["created", "stopped", "result"],
  );

  const shown = registry.show(created.delegationId);
  if (shown === null) {
    throw new Error("expected delegation to exist after stop");
  }

  assert.equal(shown.status, "stopped");
  assert.deepEqual(
    shown.events.map((event) => event.eventType),
    ["created", "stopped", "result"],
  );

  registry.close();
});

test("resume restarts a stopped delegation in the same workspace and clears the old result while running", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const adapter = new RecordingAdapter("opencode", "fake-opencode");
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    summary: "resume me",
    provider: "opencode",
  });

  const markerPath = path.join(created.workspaceReference, "resume-marker.txt");
  writeFileSync(markerPath, "keep me\n");

  const stopped = await service.stopDelegation(created.delegationId);
  assert.equal(stopped.record.status, "stopped");

  const resumed = await service.resumeDelegation(created.delegationId);
  assert.equal(resumed.record.status, "running");
  assert.equal(adapter.lastContext?.workspaceReference, created.workspaceReference);
  assert.equal(adapter.lastContext?.delegationId, created.delegationId);
  assert.equal(existsSync(markerPath), true);

  const shown = registry.show(created.delegationId);
  if (shown === null) {
    throw new Error("expected delegation to exist after resume");
  }

  assert.equal(shown.status, "running");
  assert.equal(shown.result, null);
  assert.deepEqual(
    shown.events.map((event) => event.eventType),
    ["created", "stopped", "result", "resumed", "preparing", "running"],
  );

  registry.close();
});

test("attach dispatches to a provider that supports live sessions", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const adapter = new AttachRecordingAdapter("opencode", "fake-opencode");
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    summary: "attach me",
    provider: "opencode",
  });

  const started = await service.startDelegation(created.delegationId);
  const attached = await service.attachDelegation(created.delegationId);

  assert.equal(attached.attached, true);
  assert.equal(attached.pid, started.launch.pid);
  assert.equal(attached.message, `Attached to delegation ${created.delegationId}`);
  assert.equal(adapter.lastAttachContext?.delegationId, created.delegationId);
  assert.equal(adapter.lastAttachContext?.workspaceReference, created.workspaceReference);
  assert.equal(adapter.lastAttachContext?.pid, started.launch.pid);

  const shown = registry.show(created.delegationId);
  if (shown === null) {
    throw new Error("expected delegation to exist after attach");
  }

  assert.equal(shown.status, "running");
  assert.deepEqual(
    shown.events.map((event) => event.eventType),
    ["created", "started", "preparing", "running"],
  );

  registry.close();
});

test("fan-out launches the same task across multiple providers and keeps the results comparable", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const opencodeAdapter = new RecordingAdapter("opencode", "fake-opencode");
  const claudeAdapter = new RecordingAdapter("claude-code", "fake-claude");
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [opencodeAdapter, claudeAdapter] },
  );

  const fanout = await service.fanOutDelegations({
    summary: "compare providers",
    providers: ["opencode", "claude-code"],
    metadata: { ticket: "#12" },
  });

  assert.ok(fanout.groupId.length > 0);
  assert.equal(fanout.entries.length, 2);
  assert.deepEqual(
    fanout.entries.map((entry) => entry.provider),
    ["opencode", "claude-code"],
  );
  assert.deepEqual(
    fanout.entries.map((entry) => entry.record.status),
    ["running", "running"],
  );
  assert.equal(
    opencodeAdapter.lastContext?.workspaceReference,
    fanout.entries[0]?.record.workspaceReference,
  );
  assert.equal(
    claudeAdapter.lastContext?.workspaceReference,
    fanout.entries[1]?.record.workspaceReference,
  );
  assert.notEqual(
    fanout.entries[0]?.record.workspaceReference,
    fanout.entries[1]?.record.workspaceReference,
  );
  assert.deepEqual(fanout.entries[0]?.record.metadata.fanout, {
    groupId: fanout.groupId,
    provider: "opencode",
    providerIndex: 0,
    providerCount: 2,
    providers: ["opencode", "claude-code"],
  });
  assert.equal(fanout.entries[0]?.error, null);
  assert.equal(fanout.entries[1]?.error, null);

  const shown = registry.list();
  assert.equal(shown.length, 2);
  assert.deepEqual(shown.map((record) => record.provider).sort(), ["claude-code", "opencode"]);

  registry.close();
});
