import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

export class DelegationService {
  constructor(
    private readonly registry: DelegationRegistry,
    private readonly workspaceManager: WorkspaceManager,
  ) {}

  createDelegation(input: CreateDelegationRequest): DelegationRecord {
    const delegationId = randomUUID();
    const workspaceReference = this.workspaceManager.provisionWorkspace(delegationId);

    const baseInput = {
      delegationId,
      identity: input.identity ?? "factory-agent",
      status: input.status ?? "queued",
      scope: input.scope ?? "repository",
      provider: input.provider ?? "github",
      workspaceReference,
      summary: input.summary ?? "Delegation created via fabrica-delegate create.",
    } satisfies CreateDelegationInput;

    const createInput =
      input.metadata === undefined
        ? baseInput
        : ({ ...baseInput, metadata: input.metadata } satisfies CreateDelegationInput);

    return this.registry.create(createInput);
  }

  startDelegation(delegationId: string): DelegationRecord {
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

    if (record.workspaceReference !== resolvedWorkspace) {
      return this.registry.updateWorkspaceReference(delegationId, resolvedWorkspace);
    }

    return record;
  }
}
