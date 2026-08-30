import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { watchHeadless } from "../src/watch.js";
import { WorkspaceManager } from "../src/workspace-manager.js";

const tempRoots: string[] = [];
const activeChildren: ChildProcessWithoutNullStreams[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function bunBin(): string {
  return path.join(os.homedir(), ".bun", "bin", "bun");
}

function runBun(args: string[], cwd: string, env: Record<string, string | undefined>): string {
  return execFileSync(bunBin(), args, {
    cwd,
    env,
    encoding: "utf8",
  });
}


function waitForExit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

class ContractStubAdapter implements DelegationProviderAdapter {
  readonly provider = "opencode";
  public lastContext: DelegationLaunchContext | null = null;
  public stdout = "";
  public stderr = "";
  public child: ChildProcessWithoutNullStreams | null = null;
  public exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  public artifactPath: string | null = null;

  constructor(private readonly exitCode: number) {}

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    this.lastContext = context;
    const artifactPath = path.join(context.workspaceReference, "artifacts", "stub-provider-result.txt");
    this.artifactPath = artifactPath;

    const childScript = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const [delegationId, workspaceReference, summary, metadataJson, exitCodeText, artifactPath] = process.argv.slice(1);",
      "const metadata = JSON.parse(metadataJson);",
      "fs.mkdirSync(path.dirname(artifactPath), { recursive: true });",
      "fs.writeFileSync(artifactPath, [",
      "  'delegationId=' + delegationId,",
      "  'workspaceReference=' + workspaceReference,",
      "  'summary=' + summary,",
      "  'metadata=' + JSON.stringify(metadata),",
      "].join('\\n'));",
      "process.stdout.write('starting ' + delegationId + '\\n');",
      "process.stderr.write('workspace ' + workspaceReference + '\\n');",
      "process.stdout.write('artifact ' + artifactPath + '\\n');",
      "setTimeout(() => {",
      "  process.stderr.write('done ' + delegationId + '\\n');",
      "  process.exit(Number(exitCodeText));",
      "}, 40);",
    ].join(" ");

    return await new Promise<DelegationLaunchResult>((resolve, reject) => {
      const child = spawn(
        "node",
        [
          "-e",
          childScript,
          context.delegationId,
          context.workspaceReference,
          context.summary,
          JSON.stringify(context.metadata),
          String(this.exitCode),
          artifactPath,
        ],
        {
          cwd: context.workspaceReference,
          env: {
            ...process.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      activeChildren.push(child);
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        this.stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        this.stderr += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        this.exit = { code, signal };
      });
      child.once("spawn", () => {
        if (child.pid == null) {
          reject(new Error("expected provider pid"));
          return;
        }

        resolve({
          provider: this.provider,
          command: process.execPath,
          args: [
            "--input-type=commonjs",
            "-e",
            "<stub-provider>",
            context.delegationId,
            context.workspaceReference,
            context.summary,
            JSON.stringify(context.metadata),
            String(this.exitCode),
            artifactPath,
          ],
          pid: child.pid,
          workspaceReference: context.workspaceReference,
          startedAt: new Date().toISOString(),
        });
      });
    });
  }
}

afterEach(() => {
  while (activeChildren.length > 0) {
    const child = activeChildren.pop();
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("deterministic stub provider surfaces create → start → watch → result", async () => {
  const repoRoot = process.cwd();
  const dataRoot = createTempDir("fabrica-contract-data-");
  const workspaceRoot = path.join(dataRoot, "workspaces");
  const dbPath = path.join(dataRoot, "delegations.sqlite3");
  const registry = new DelegationRegistry(dbPath);
  const adapter = new ContractStubAdapter(7);
  const service = new DelegationService(
    registry,
    new WorkspaceManager({ repoRoot, workspacesRoot: workspaceRoot }),
    { adapters: [adapter] },
  );

  const created = service.createDelegation({
    provider: "opencode",
    summary: "contract-test stub provider",
    metadata: { issue: 43, contract: true },
  });

  const watchLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    watchLogs.push(args.map((value) => String(value)).join(" "));
  };

  try {
    const watchPromise = watchHeadless(registry, created.delegationId, { pollIntervalMs: 25 });

    const started = await service.startDelegation(created.delegationId);
    assert.equal(started.record.status, "running");
    assert.equal(adapter.lastContext?.delegationId, created.delegationId);
    assert.equal(adapter.lastContext?.workspaceReference, created.workspaceReference);
    assert.ok(adapter.artifactPath !== null);
    assert.equal(existsSync(adapter.artifactPath), false);

    assert.ok(adapter.child !== null);
    const providerExit = await waitForExit(adapter.child);

    assert.equal(providerExit.code, 7);
    if (adapter.exit === null) {
      throw new Error("expected provider exit result");
    }
    const exit = adapter.exit;
    const exitCode = exit.code;
    if (exitCode === null) {
      throw new Error("expected provider exit code");
    }
    assert.equal(exitCode, 7);
    assert.match(adapter.stdout, /starting/);
    assert.match(adapter.stdout, /artifact/);
    assert.match(adapter.stderr, /workspace/);
    assert.match(adapter.stderr, /done/);
    if (adapter.artifactPath === null) {
      throw new Error("expected provider artifact path");
    }
    const artifactPath = adapter.artifactPath;
    assert.equal(existsSync(artifactPath), true);

    const artifactContents = readFileSync(artifactPath, "utf8");
    assert.match(artifactContents, /delegationId=/);
    assert.match(artifactContents, /contract-test stub provider/);

    const terminal = registry.recordLifecycleEvent(created.delegationId, "completed", "completed", {
      delegationId: created.delegationId,
      exitCode: exitCode,
      summary: "stub contract slice complete",
      artifacts: [
        {
          path: artifactPath,
          kind: "file",
          description: "stub provider result artifact",
        },
      ],
    });
    const completed = registry.recordFinalResult(created.delegationId, {
      exitCode: exitCode,
      status: "completed",
      summary: terminal.summary,
      metadata: {
        ...started.record.metadata,
        provider_stdout: adapter.stdout.trim().split(/\r?\n/),
        provider_stderr: adapter.stderr.trim().split(/\r?\n/),
      },
      artifacts: [
        {
          path: artifactPath,
          kind: "file",
          description: "stub provider result artifact",
        },
      ],
    });

    const record = registry.show(created.delegationId);
    assert.ok(record);
    assert.equal(record?.status, "completed");
    assert.equal(record?.result?.exitCode, 7);
    assert.equal(record?.result?.artifacts[0]?.path, adapter.artifactPath);

    await watchPromise;
    assert.match(watchLogs.join("\n"), /watching/);
    assert.match(watchLogs.join("\n"), /status=queued/);
    assert.match(watchLogs.join("\n"), /started/);
    assert.match(watchLogs.join("\n"), /pid=/);
    assert.match(watchLogs.join("\n"), /completed/);

    const resultOutput = runBun(["run", "src/index.ts", "result", created.delegationId], repoRoot, {
      ...process.env,
      FABRICA_DELEGATE_DB: dbPath,
    });
    assert.match(resultOutput, /final result/);
    assert.match(resultOutput, /exit_code: 7/);
    assert.match(resultOutput, /stub provider result artifact/);
    assert.match(resultOutput, /stub-provider-result\.txt/);

    assert.equal(completed.result?.exitCode, 7);
  } finally {
    console.log = originalLog;
    registry.close();
  }
});
