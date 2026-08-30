import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationService } from "../src/delegation-service.js";
import type {
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
  readonly provider = "opencode";
  public lastContext: DelegationLaunchContext | null = null;

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    this.lastContext = context;
    return {
      provider: this.provider,
      command: "fake-opencode",
      args: ["--headless"],
      pid: 4242,
      workspaceReference: context.workspaceReference,
      startedAt: new Date().toISOString(),
    };
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

test("start records lifecycle events and launches the adapter in the isolated workspace", async () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const adapter = new RecordingAdapter();
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    summary: "launch me",
    provider: "opencode",
  });

  const started = await service.startDelegation(created.delegationId);

  assert.equal(started.record.status, "running");
  assert.equal(started.record.provider, "opencode");
  assert.equal(adapter.lastContext?.workspaceReference, created.workspaceReference);
  assert.equal(adapter.lastContext?.delegationId, created.delegationId);
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
});
