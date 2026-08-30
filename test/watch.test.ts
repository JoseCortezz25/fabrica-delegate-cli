import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { DelegationRegistry } from "../src/registry.js";
import { type WatchSnapshot, formatHeadlessSnapshot, formatVisibleSnapshot } from "../src/watch.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function bunBin(): string {
  return path.join(os.homedir(), ".bun", "bin", "bun");
}

function waitForLine(output: string[], matcher: RegExp, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (output.some((line) => matcher.test(line))) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${String(matcher)}`));
      }
    }, 25);
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

test("headless and visible formatters summarize the live delegation state", () => {
  const snapshot: WatchSnapshot = {
    record: {
      delegationId: "delegation-1",
      identity: "factory-agent",
      status: "running",
      scope: "repository",
      provider: "opencode",
      workspaceReference: "/tmp/workspace",
      summary: "watch issue",
      metadata: {},
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:01.000Z",
      result: null,
      events: [
        {
          eventId: 1,
          delegationId: "delegation-1",
          eventType: "created",
          payload: { delegationId: "delegation-1", summary: "watch issue" },
          createdAt: "2026-08-30T00:00:00.000Z",
        },
        {
          eventId: 2,
          delegationId: "delegation-1",
          eventType: "heartbeat",
          payload: { delegationId: "delegation-1", note: "ignore me" },
          createdAt: "2026-08-30T00:00:01.000Z",
        },
      ],
    },
    lastEventId: 2,
  } as const;

  assert.deepEqual(
    formatHeadlessSnapshot(snapshot).filter((line) => line.includes("heartbeat")),
    [],
  );
  assert.match(formatHeadlessSnapshot(snapshot).join("\n"), /status=running/);
  assert.match(formatVisibleSnapshot(snapshot).join("\n"), /Events:/);
  assert.match(formatVisibleSnapshot(snapshot).join("\n"), /heartbeat/);
});

test("watch headless streams persisted live transitions and exits on completion", async () => {
  const repoRoot = process.cwd();
  const dbPath = path.join(createTempDir("fabrica-watch-db-"), "delegations.sqlite3");
  const registry = new DelegationRegistry(dbPath);
  const created = registry.create({
    identity: "factory-agent",
    status: "queued",
    scope: "repository",
    provider: "opencode",
    workspaceReference: "/tmp/fabrica-watch-workspace",
    summary: "watch issue #5",
    metadata: { issue: 5 },
  });

  const child = spawn(
    bunBin(),
    ["run", "src/index.ts", "watch", created.delegationId, "--headless", "--poll-interval", "25"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        FABRICA_DELEGATE_DB: dbPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutLines.push(...chunk.split(/\r?\n/).filter(Boolean));
  });
  child.stderr?.on("data", (chunk: string) => {
    stderrLines.push(...chunk.split(/\r?\n/).filter(Boolean));
  });

  await waitForLine(stdoutLines, /status=queued/);

  registry.recordLifecycleEvent(created.delegationId, "running", "heartbeat", {
    delegationId: created.delegationId,
    note: "nonessential telemetry",
  });
  registry.recordLifecycleEvent(created.delegationId, "completed", "completed", {
    delegationId: created.delegationId,
    artifact: "report.md",
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );

  registry.close();

  assert.equal(exit.code, 0, stderrLines.join("\n"));
  assert.match(stdoutLines.join("\n"), /watching/);
  assert.match(stdoutLines.join("\n"), /status=queued/);
  assert.match(stdoutLines.join("\n"), /completed/);
  assert.doesNotMatch(stdoutLines.join("\n"), /heartbeat/);
});
