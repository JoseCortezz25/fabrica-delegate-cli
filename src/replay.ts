import type { DelegationEvent, DelegationRecord, DelegationRegistry } from "./registry.js";

const LIFECYCLE_EVENT_TYPES = new Set([
  "started",
  "preparing",
  "running",
  "failed",
  "stopped",
  "completed",
  "cancelled",
  "canceled",
]);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyValue(item)).join(", ")}]`;
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatPayloadDetail(label: string, value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return `${label}: ${stringifyValue(value)}`;
}

function nextStatusForEvent(event: DelegationEvent, currentStatus: string | null): string | null {
  const payload = event.payload as Record<string, unknown>;
  const explicitStatus = asNonEmptyString(payload.status);
  if (explicitStatus !== null) {
    return explicitStatus;
  }

  const normalizedType = event.eventType.toLowerCase();
  if (normalizedType === "created") {
    return currentStatus;
  }

  if (normalizedType === "workspace_updated") {
    return currentStatus;
  }

  if (normalizedType === "result") {
    return currentStatus;
  }

  if (LIFECYCLE_EVENT_TYPES.has(normalizedType)) {
    return event.eventType;
  }

  return currentStatus;
}

function formatEventDetails(event: DelegationEvent): string[] {
  const payload = event.payload as Record<string, unknown>;
  const details: string[] = [];

  if (event.eventType === "created") {
    const values = [
      formatPayloadDetail("status", payload.status),
      formatPayloadDetail("provider", payload.provider),
      formatPayloadDetail("scope", payload.scope),
      formatPayloadDetail("summary", payload.summary),
      formatPayloadDetail("workspace", payload.workspaceReference),
    ];

    for (const value of values) {
      if (value !== null) {
        details.push(value);
      }
    }

    return details;
  }

  if (event.eventType === "workspace_updated") {
    const value = formatPayloadDetail("workspace", payload.workspaceReference);
    if (value !== null) {
      details.push(value);
    }

    return details;
  }

  if (event.eventType === "running") {
    const values = [
      formatPayloadDetail("provider", payload.provider),
      formatPayloadDetail("pid", payload.pid),
      formatPayloadDetail("command", payload.command),
      formatPayloadDetail("args", payload.args),
      formatPayloadDetail("launched_at", payload.launchedAt),
    ];

    for (const value of values) {
      if (value !== null) {
        details.push(value);
      }
    }

    return details;
  }

  if (event.eventType === "stopped") {
    const values = [
      formatPayloadDetail("previous_status", payload.previousStatus),
      formatPayloadDetail("pid", payload.pid),
      formatPayloadDetail("signal", payload.signal),
    ];

    for (const value of values) {
      if (value !== null) {
        details.push(value);
      }
    }

    return details;
  }

  if (event.eventType === "result") {
    const values = [
      formatPayloadDetail("status", payload.status),
      formatPayloadDetail("exit_code", payload.exitCode),
      formatPayloadDetail("summary", payload.summary),
      formatPayloadDetail("recorded_at", payload.recordedAt),
      formatPayloadDetail("artifacts", payload.artifacts),
    ];

    for (const value of values) {
      if (value !== null) {
        details.push(value);
      }
    }

    return details;
  }

  if (event.eventType === "provider_stdout" || event.eventType === "provider_stderr") {
    const values = [
      formatPayloadDetail("stream", payload.stream),
      formatPayloadDetail("chunk", payload.chunk),
    ];

    for (const value of values) {
      if (value !== null) {
        details.push(value);
      }
    }

    return details;
  }

  const values = [
    formatPayloadDetail("previous_status", payload.previousStatus),
    formatPayloadDetail("error", payload.error),
    formatPayloadDetail("summary", payload.summary),
  ];

  for (const value of values) {
    if (value !== null) {
      details.push(value);
    }
  }

  return details;
}

export function formatReplayLines(record: DelegationRecord): string[] {
  const lines = [
    `Replay delegation ${record.delegationId}`,
    "Source: persisted events",
    `Events: ${record.events.length}`,
    "",
  ];

  let currentStatus: string | null = null;

  record.events.forEach((event, index) => {
    const nextStatus = nextStatusForEvent(event, currentStatus);
    lines.push(`[${index + 1}] ${event.createdAt} ${event.eventType} #${event.eventId}`);
    lines.push(`  state: ${currentStatus ?? "(none)"} -> ${nextStatus ?? "(unknown)"}`);
    lines.push(`  payload: ${JSON.stringify(event.payload)}`);

    for (const detail of formatEventDetails(event)) {
      lines.push(`  ${detail}`);
    }

    lines.push("");
    currentStatus = nextStatus;
  });

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

export function printReplay(registry: DelegationRegistry, delegationId: string): void {
  const record = registry.replay(delegationId);

  if (record === null) {
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  for (const line of formatReplayLines(record)) {
    console.log(line);
  }
}
