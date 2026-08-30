import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { OpenCodeAdapter } from "./opencode-adapter.js";
import type { DelegationLaunchResult, DelegationProviderAdapter } from "./provider-adapters.js";
import type { CreateDelegationInput, DelegationRecord, DelegationRegistry } from "./registry.js";
import type { WorkspaceManager } from "./workspace-manager.js";

export interface CreateDelegationRequest {
  identity?: string | undefined;
  status?: string | undefined;
  scope?: string | undefined;
  provider?: string | undefined;
  summary?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface StartDelegationResult {
  record: DelegationRecord;
  launch: DelegationLaunchResult;
}

export interface StopDelegationResult {
  record: DelegationRecord;
  pid: number | null;
}

export interface DelegationServiceOptions {
  adapters?: Iterable<DelegationProviderAdapter>;
}

function adapterMap(
  adapters: Iterable<DelegationProviderAdapter>,
): Map<string, DelegationProviderAdapter> {
  const map = new Map<string, DelegationProviderAdapter>();
  for (const adapter of adapters) {
    map.set(adapter.provider, adapter);
  }

  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}

function findLaunchPid(record: DelegationRecord): number | null {
  for (let index = record.events.length - 1; index >= 0; index -= 1) {
    const payload = record.events[index]?.payload;
    const pid = payload?.pid;
    if (typeof pid === "number" && Number.isFinite(pid)) {
      return pid;
    }
  }

  return null;
}

async function waitForProcessExit(pid: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isNoSuchProcess(error)) {
        return true;
      }

      throw error;
    }

    await sleep(50);
  }

  return false;
}

export class DelegationService {
  private readonly providers: Map<string, DelegationProviderAdapter>;

  constructor(
    private readonly registry: DelegationRegistry,
    private readonly workspaceManager: WorkspaceManager,
    options: DelegationServiceOptions = {},
  ) {
    const adapters = options.adapters ?? [new OpenCodeAdapter()];
    this.providers = adapterMap(adapters);
  }

  createDelegation(input: CreateDelegationRequest): DelegationRecord {
    const baseInput = {
      identity: input.identity ?? "factory-agent",
      status: input.status ?? "queued",
      scope: input.scope ?? "repository",
      provider: input.provider ?? "opencode",
      summary: input.summary ?? "Delegation created via fabrica-delegate create.",
    } satisfies Omit<CreateDelegationInput, "delegationId" | "workspaceReference">;

    const delegationId = randomUUID();
    const workspaceReference = this.workspaceManager.provisionWorkspace(delegationId);

    const createInput =
      input.metadata === undefined
        ? ({
            ...baseInput,
            delegationId,
            workspaceReference,
          } satisfies CreateDelegationInput)
        : ({
            ...baseInput,
            delegationId,
            workspaceReference,
            metadata: input.metadata,
          } satisfies CreateDelegationInput);

    return this.registry.create(createInput);
  }

  async startDelegation(delegationId: string): Promise<StartDelegationResult> {
    const record = this.registry.show(delegationId);

    if (record === null) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    const workspaceReference =
      record.workspaceReference.trim().length > 0
        ? record.workspaceReference
        : this.workspaceManager.provisionWorkspace(delegationId);

    const resolvedWorkspace = existsSync(workspaceReference)
      ? workspaceReference
      : this.workspaceManager.provisionWorkspace(delegationId);

    const workspaceRecord =
      record.workspaceReference === resolvedWorkspace
        ? record
        : this.registry.updateWorkspaceReference(delegationId, resolvedWorkspace);

    const adapter = this.providers.get(workspaceRecord.provider);
    if (adapter === undefined) {
      throw new Error(`No provider adapter registered for ${workspaceRecord.provider}`);
    }

    const lifecycleContext = {
      delegationId,
      workspaceReference: resolvedWorkspace,
      summary: workspaceRecord.summary,
      metadata: workspaceRecord.metadata,
    };

    const started = this.registry.recordLifecycleEvent(
      delegationId,
      "started",
      "started",
      lifecycleContext,
    );
    const preparing = this.registry.recordLifecycleEvent(delegationId, "preparing", "preparing", {
      ...lifecycleContext,
      previousStatus: started.status,
    });

    try {
      const launch = await adapter.start(lifecycleContext);
      const running = this.registry.recordLifecycleEvent(delegationId, "running", "running", {
        ...lifecycleContext,
        pid: launch.pid,
        command: launch.command,
        args: launch.args,
        provider: launch.provider,
        launchedAt: launch.startedAt,
      });

      return { record: running, launch };
    } catch (error) {
      this.registry.recordLifecycleEvent(delegationId, "failed", "failed", {
        ...lifecycleContext,
        previousStatus: preparing.status,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stopDelegation(delegationId: string): Promise<StopDelegationResult> {
    const record = this.registry.show(delegationId);

    if (record === null) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    const pid = findLaunchPid(record);
    if (record.status === "stopped") {
      return { record, pid };
    }

    const stopContext = {
      delegationId,
      workspaceReference: record.workspaceReference,
      summary: record.summary,
      metadata: record.metadata,
      pid,
      previousStatus: record.status,
    };

    if (pid === null) {
      const stopped = this.registry.recordLifecycleEvent(delegationId, "stopped", "stopped", {
        ...stopContext,
        signal: null,
      });

      return { record: stopped, pid: null };
    }

    try {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (!isNoSuchProcess(error)) {
          throw error;
        }
      }

      const exited = await waitForProcessExit(pid);
      if (!exited) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (!isNoSuchProcess(error)) {
            throw error;
          }
        }

        await waitForProcessExit(pid);
      }

      const stopped = this.registry.recordLifecycleEvent(delegationId, "stopped", "stopped", {
        ...stopContext,
        signal: exited ? "SIGTERM" : "SIGKILL",
      });

      return { record: stopped, pid };
    } catch (error) {
      this.registry.recordLifecycleEvent(delegationId, "failed", "stop_failed", {
        ...stopContext,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
