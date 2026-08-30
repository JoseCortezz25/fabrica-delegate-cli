import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { ClaudeCodeAdapter } from "./claude-code-adapter.js";
import { OpenCodeAdapter } from "./opencode-adapter.js";
import type { DelegationLaunchResult, DelegationProviderAdapter } from "./provider-adapters.js";
import type {
  CreateDelegationInput,
  DelegationArtifact,
  DelegationRecord,
  DelegationRegistry,
} from "./registry.js";
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

export interface ResumeDelegationResult {
  record: DelegationRecord;
  launch: DelegationLaunchResult;
}

export interface FanoutDelegationRequest extends CreateDelegationRequest {
  providers: string[];
}

export interface FanoutDelegationEntry {
  provider: string;
  record: DelegationRecord;
  launch: DelegationLaunchResult | null;
  error: string | null;
}

export interface FanoutDelegationResult {
  groupId: string;
  summary: string;
  entries: FanoutDelegationEntry[];
}

export interface AttachDelegationResult {
  record: DelegationRecord;
  pid: number | null;
  attached: boolean;
  message: string;
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

function normalizeProviders(providers: Iterable<string>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    const trimmed = provider.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
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

function getRunningContext(record: DelegationRecord): DelegationLaunchResult | null {
  for (let index = record.events.length - 1; index >= 0; index -= 1) {
    const event = record.events[index];
    if (event?.eventType !== "running") {
      continue;
    }

    const payload = event.payload;
    const pid = payload?.pid;
    const command = payload?.command;
    const args = payload?.args;
    const provider = payload?.provider;
    const launchedAt = payload?.launchedAt;

    if (
      typeof pid !== "number" ||
      !Number.isFinite(pid) ||
      typeof command !== "string" ||
      typeof provider !== "string" ||
      !Array.isArray(args) ||
      typeof launchedAt !== "string"
    ) {
      return null;
    }

    return {
      pid,
      command,
      args: args.flatMap((value) => (typeof value === "string" ? [value] : [])),
      provider,
      workspaceReference: record.workspaceReference,
      startedAt: launchedAt,
    };
  }

  return null;
}

function normalizeArtifacts(metadata: Record<string, unknown>): DelegationArtifact[] {
  const rawArtifacts = metadata.artifacts;
  if (!Array.isArray(rawArtifacts)) {
    return [];
  }

  return rawArtifacts.flatMap((artifact) => {
    if (artifact === null || typeof artifact !== "object") {
      return [];
    }

    const candidate = artifact as Record<string, unknown>;
    if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
      return [];
    }

    const normalized: DelegationArtifact = { path: candidate.path };
    if (typeof candidate.kind === "string" && candidate.kind.trim().length > 0) {
      normalized.kind = candidate.kind;
    }
    if (typeof candidate.description === "string" && candidate.description.trim().length > 0) {
      normalized.description = candidate.description;
    }

    return [normalized];
  });
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
    const adapters = options.adapters ?? [new OpenCodeAdapter(), new ClaudeCodeAdapter()];
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

  async resumeDelegation(delegationId: string): Promise<ResumeDelegationResult> {
    const record = this.registry.show(delegationId);

    if (record === null) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    if (record.status !== "stopped" && record.status !== "failed") {
      throw new Error(`Delegation ${delegationId} is not resumable from status ${record.status}`);
    }

    if (!existsSync(record.workspaceReference)) {
      throw new Error(
        `Workspace not found for delegation ${delegationId}: ${record.workspaceReference}`,
      );
    }

    const adapter = this.providers.get(record.provider);
    if (adapter === undefined) {
      throw new Error(`No provider adapter registered for ${record.provider}`);
    }

    const lifecycleContext = {
      delegationId,
      workspaceReference: record.workspaceReference,
      summary: record.summary,
      metadata: record.metadata,
      previousStatus: record.status,
    };

    const resumed = this.registry.recordLifecycleEvent(
      delegationId,
      "resuming",
      "resumed",
      lifecycleContext,
    );
    const preparing = this.registry.recordLifecycleEvent(delegationId, "preparing", "preparing", {
      ...lifecycleContext,
      previousStatus: resumed.status,
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
    if (record.status === "stopped" && record.result !== null) {
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

    const artifacts = normalizeArtifacts(record.metadata);

    if (pid === null) {
      const stopped = this.registry.recordLifecycleEvent(delegationId, "stopped", "stopped", {
        ...stopContext,
        signal: null,
      });
      const result = this.registry.recordFinalResult(delegationId, {
        exitCode: 0,
        status: stopped.status,
        summary: stopped.summary,
        metadata: stopped.metadata,
        artifacts,
        sourceEventType: "result",
      });

      return { record: result, pid: null };
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
      const result = this.registry.recordFinalResult(delegationId, {
        exitCode: exited ? 143 : 137,
        status: stopped.status,
        summary: stopped.summary,
        metadata: stopped.metadata,
        artifacts,
        sourceEventType: "result",
      });

      return { record: result, pid };
    } catch (error) {
      this.registry.recordLifecycleEvent(delegationId, "failed", "stop_failed", {
        ...stopContext,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async fanOutDelegations(input: FanoutDelegationRequest): Promise<FanoutDelegationResult> {
    const providers = normalizeProviders(input.providers);

    if (providers.length < 2) {
      throw new Error("Fan-out requires at least two distinct providers");
    }

    const unknownProvider = providers.find((provider) => !this.providers.has(provider));
    if (unknownProvider !== undefined) {
      throw new Error(`No provider adapter registered for ${unknownProvider}`);
    }

    const groupId = randomUUID();
    const summary = input.summary ?? "Delegation created via fabrica-delegate create.";
    const baseMetadata = input.metadata ?? {};
    const createdRecords = providers.map((provider, index) => {
      const metadata = {
        ...baseMetadata,
        fanout: {
          groupId,
          provider,
          providerIndex: index,
          providerCount: providers.length,
          providers,
        },
      };

      return {
        provider,
        created: this.createDelegation({
          identity: input.identity,
          status: input.status,
          scope: input.scope,
          provider,
          summary,
          metadata,
        }),
      };
    });

    const settled = await Promise.allSettled(
      createdRecords.map((entry) => this.startDelegation(entry.created.delegationId)),
    );

    const entries = createdRecords.map((entry, index) => {
      const outcome = settled[index];

      if (outcome?.status === "fulfilled") {
        return {
          provider: entry.provider,
          record: outcome.value.record,
          launch: outcome.value.launch,
          error: null,
        } satisfies FanoutDelegationEntry;
      }

      const record = this.registry.show(entry.created.delegationId) ?? entry.created;
      return {
        provider: entry.provider,
        record,
        launch: null,
        error:
          outcome?.status === "rejected"
            ? outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason)
            : "Unknown fan-out failure",
      } satisfies FanoutDelegationEntry;
    });

    return {
      groupId,
      summary,
      entries,
    };
  }

  async attachDelegation(delegationId: string): Promise<AttachDelegationResult> {
    const record = this.registry.show(delegationId);

    if (record === null) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    if (record.status !== "running") {
      throw new Error(`Delegation ${delegationId} is not running`);
    }

    const adapter = this.providers.get(record.provider);
    if (adapter === undefined) {
      throw new Error(`No provider adapter registered for ${record.provider}`);
    }

    const pid = findLaunchPid(record);
    const runningContext = getRunningContext(record);

    if (adapter.attach === undefined) {
      return {
        record,
        pid,
        attached: false,
        message: `Provider ${record.provider} does not support attach`,
      };
    }

    if (runningContext === null) {
      throw new Error(`Delegation ${delegationId} does not have a live session to attach to`);
    }

    await adapter.attach({
      delegationId,
      workspaceReference: runningContext.workspaceReference,
      summary: record.summary,
      metadata: record.metadata,
      pid,
    });

    return {
      record,
      pid,
      attached: true,
      message: `Attached to delegation ${delegationId}`,
    };
  }
}
