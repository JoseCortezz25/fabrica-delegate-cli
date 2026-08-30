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
}
