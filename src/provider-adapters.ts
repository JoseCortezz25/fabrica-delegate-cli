export interface DelegationLaunchContext {
  delegationId: string;
  workspaceReference: string;
  summary: string;
  metadata: Record<string, unknown>;
  emitEvent?: (eventType: string, payload: Record<string, unknown>) => void;
}

export interface DelegationAttachContext extends DelegationLaunchContext {
  pid: number | null;
}

export interface DelegationLaunchResult {
  provider: string;
  command: string;
  args: string[];
  pid: number;
  workspaceReference: string;
  startedAt: string;
}

export interface DelegationProviderAdapter {
  readonly provider: string;
  start(context: DelegationLaunchContext): Promise<DelegationLaunchResult>;
  attach?(context: DelegationAttachContext): Promise<void>;
}
