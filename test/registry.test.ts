import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DelegationRegistry } from "../src/registry.js";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fabrica-registry-"));
  tempDirs.push(dir);
  return path.join(dir, "delegations.sqlite3");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("DelegationRegistry", () => {
  beforeEach(() => {
    tempDirs.length = 0;
  });

  test("persists delegations across reopen", () => {
    const dbPath = tempDbPath();
    const firstRegistry = new DelegationRegistry(dbPath);
    const created = firstRegistry.create({
      identity: "agent-2",
      status: "queued",
      scope: "repository",
      provider: "github",
      workspaceReference: "/tmp/fabrica-workspace",
      summary: "Track issue #2 work",
      metadata: { issue: 2, priority: "high" },
    });
    firstRegistry.close();

    const secondRegistry = new DelegationRegistry(dbPath);
    const listed = secondRegistry.list();
    const shown = secondRegistry.show(created.delegationId);
    secondRegistry.close();

    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.delegationId, created.delegationId);
    assert.equal(listed[0]?.identity, "agent-2");
    assert.equal(listed[0]?.eventCount, 1);
    assert.equal(shown?.delegationId, created.delegationId);
    assert.equal(shown?.metadata.issue, 2);
    assert.equal(shown?.events.length, 1);
    assert.equal(shown?.events[0]?.eventType, "created");
  });

  test("returns null for missing delegations", () => {
    const registry = new DelegationRegistry(tempDbPath());
    assert.equal(registry.show("missing-id"), null);
    registry.close();
  });
});
