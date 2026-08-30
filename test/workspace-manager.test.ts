import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationService } from "../src/delegation-service.js";
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

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("creates isolated workspaces and records their paths", () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
  );

  const first = service.createDelegation({ summary: "first delegation" });
  const second = service.createDelegation({ summary: "second delegation" });

  assert.ok(first.workspaceReference.length > 0);
  assert.ok(second.workspaceReference.length > 0);
  assert.notEqual(first.workspaceReference, second.workspaceReference);
  assert.equal(registry.show(first.delegationId)?.workspaceReference, first.workspaceReference);
  assert.equal(registry.show(second.delegationId)?.workspaceReference, second.workspaceReference);

  const firstMarker = path.join(first.workspaceReference, "first-only.txt");
  writeFileSync(firstMarker, "isolated state\n");

  assert.equal(existsSync(firstMarker), true);
  assert.equal(existsSync(path.join(second.workspaceReference, "first-only.txt")), false);

  registry.close();
});

test("start provisions a missing workspace and updates the delegation", () => {
  const { repoRoot, workspaceRoot, registryPath } = createGitRepo();
  const registry = new DelegationRegistry(registryPath);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
  );

  const seeded = registry.create({
    delegationId: "delegation-start",
    identity: "factory-agent",
    status: "queued",
    scope: "repository",
    provider: "github",
    workspaceReference: path.join(workspaceRoot, "missing-workspace"),
    summary: "seeded delegation",
  });

  assert.equal(existsSync(seeded.workspaceReference), false);

  const started = service.startDelegation(seeded.delegationId);

  assert.notEqual(started.workspaceReference, seeded.workspaceReference);
  assert.equal(existsSync(started.workspaceReference), true);
  assert.equal(registry.show(seeded.delegationId)?.workspaceReference, started.workspaceReference);
  assert.equal(started.events.at(-1)?.eventType, "workspace_updated");

  registry.close();
});
