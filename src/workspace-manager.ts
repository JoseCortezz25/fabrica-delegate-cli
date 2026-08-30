import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import { basename, join, resolve } from "node:path";

export interface WorkspaceManagerOptions {
  repoRoot?: string;
  workspacesRoot?: string;
}

function resolveGitRoot(cwd: string): string | null {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function resolveWorkspacesRoot(repoRoot: string, configuredRoot?: string): string {
  const root =
    configuredRoot ??
    process.env.FABRICA_WORKSPACE_ROOT ??
    join(os.homedir(), ".fabrica", "workspaces", basename(repoRoot));

  return resolve(root);
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export class WorkspaceManager {
  readonly repoRoot: string;
  readonly workspacesRoot: string;

  constructor(options: WorkspaceManagerOptions = {}) {
    const repoRoot = options.repoRoot ?? resolveGitRoot(process.cwd()) ?? process.cwd();

    this.repoRoot = resolve(repoRoot);
    this.workspacesRoot = resolveWorkspacesRoot(this.repoRoot, options.workspacesRoot);
    ensureDirectory(this.workspacesRoot);
  }

  workspacePath(delegationId: string): string {
    return join(this.workspacesRoot, delegationId);
  }

  provisionWorkspace(delegationId: string): string {
    const workspacePath = this.workspacePath(delegationId);

    if (existsSync(workspacePath)) {
      return workspacePath;
    }

    const gitWorktree = spawnSync(
      "git",
      ["-C", this.repoRoot, "worktree", "add", "--detach", "--force", workspacePath, "HEAD"],
      { encoding: "utf8" },
    );

    if (gitWorktree.status === 0) {
      return workspacePath;
    }

    ensureDirectory(workspacePath);
    return workspacePath;
  }
}
