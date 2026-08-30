import { Box, Text, render } from "ink";
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { DelegationEvent, DelegationRecord, DelegationRegistry } from "./registry.js";

export type WatchMode = "headless" | "visible";

export interface WatchSnapshot {
  record: DelegationRecord;
  lastEventId: number | null;
}

export interface WatchRuntimeOptions {
  pollIntervalMs?: number;
  mode?: WatchMode;
}

const TERMINAL_STATUSES = new Set([
  "failed",
  "completed",
  "cancelled",
  "canceled",
  "done",
  "finished",
]);
const IMPORTANT_EVENT_TYPES = new Set([
  "created",
  "workspace_updated",
  "started",
  "preparing",
  "running",
  "failed",
  "completed",
  "cancelled",
  "canceled",
]);

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
    .filter(([key]) => key !== "delegationId")
    .map(([key, value]) => `${key}=${stringifyValue(value)}`);

  return entries.length === 0 ? "" : ` ${entries.join(" ")}`;
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

export function snapshotDelegation(
  registry: DelegationRegistry,
  delegationId: string,
): WatchSnapshot | null {
  const record = registry.show(delegationId);
  if (record === null) {
    return null;
  }

  return {
    record,
    lastEventId: record.events.at(-1)?.eventId ?? null,
  };
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

export function isImportantEvent(event: DelegationEvent): boolean {
  return IMPORTANT_EVENT_TYPES.has(event.eventType.toLowerCase());
}

export function formatHeadlessEvent(event: DelegationEvent): string | null {
  if (!isImportantEvent(event)) {
    return null;
  }

  const detail = summarizePayload(event.payload);
  return `[${formatTimestamp(event.createdAt)}] ${event.eventType}${detail}`.trim();
}

export function formatHeadlessSnapshot(snapshot: WatchSnapshot): string[] {
  const lines = [
    `watching ${snapshot.record.delegationId}`,
    `status=${snapshot.record.status} provider=${snapshot.record.provider} identity=${snapshot.record.identity}`,
    `workspace=${snapshot.record.workspaceReference}`,
    `summary=${snapshot.record.summary}`,
  ];

  for (const event of snapshot.record.events) {
    const formatted = formatHeadlessEvent(event);
    if (formatted !== null) {
      lines.push(formatted);
    }
  }

  return lines;
}

export function formatVisibleSnapshot(snapshot: WatchSnapshot): string[] {
  const lines = [
    `Delegation ${snapshot.record.delegationId}`,
    `Status: ${snapshot.record.status}`,
    `Provider: ${snapshot.record.provider}`,
    `Identity: ${snapshot.record.identity}`,
    `Workspace: ${snapshot.record.workspaceReference}`,
    `Summary: ${snapshot.record.summary}`,
    `Updated: ${snapshot.record.updatedAt}`,
    "",
    "Events:",
  ];

  if (snapshot.record.events.length === 0) {
    lines.push("  (none)");
  } else {
    for (const event of snapshot.record.events) {
      const detail = summarizePayload(event.payload);
      lines.push(`  - [${event.eventType}] ${formatTimestamp(event.createdAt)}${detail}`.trim());
    }
  }

  return lines;
}

export async function watchHeadless(
  registry: DelegationRegistry,
  delegationId: string,
  options: WatchRuntimeOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const initial = snapshotDelegation(registry, delegationId);
  if (initial === null) {
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  for (const line of formatHeadlessSnapshot(initial)) {
    console.log(line);
  }

  let seenEventCount = initial.record.events.length;
  let latestStatus = initial.record.status;

  while (!isTerminalStatus(latestStatus)) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const next = snapshotDelegation(registry, delegationId);
    if (next === null) {
      throw new Error(`Delegation not found: ${delegationId}`);
    }

    const freshEvents = next.record.events.slice(seenEventCount);
    for (const event of freshEvents) {
      const formatted = formatHeadlessEvent(event);
      if (formatted !== null) {
        console.log(formatted);
      }
    }

    seenEventCount = next.record.events.length;
    latestStatus = next.record.status;
  }
}

function VisibleWatchApp(props: {
  registry: DelegationRegistry;
  delegationId: string;
  pollIntervalMs: number;
  onTerminal: () => void;
}): ReactElement {
  const { registry, delegationId, pollIntervalMs, onTerminal } = props;
  const [snapshot, setSnapshot] = useState<WatchSnapshot | null>(() =>
    snapshotDelegation(registry, delegationId),
  );

  useEffect(() => {
    let cancelled = false;

    const refresh = (): void => {
      const next = snapshotDelegation(registry, delegationId);
      if (cancelled || next === null) {
        return;
      }

      setSnapshot(next);
      if (isTerminalStatus(next.record.status)) {
        onTerminal();
      }
    };

    refresh();
    const timer = setInterval(refresh, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [delegationId, onTerminal, pollIntervalMs, registry]);

  const lines = useMemo(() => {
    if (snapshot === null) {
      return [`Delegation ${delegationId} not found.`];
    }

    return formatVisibleSnapshot(snapshot);
  }, [delegationId, snapshot]);

  if (snapshot === null) {
    return createElement(Text, null, lines[0]);
  }

  return createElement(
    Box,
    { flexDirection: "column" },
    ...lines.map((line, index) => createElement(Text, { key: `${index}-${line}` }, line)),
  );
}

export async function watchVisible(
  registry: DelegationRegistry,
  delegationId: string,
  options: WatchRuntimeOptions = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const initial = snapshotDelegation(registry, delegationId);
  if (initial === null) {
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    const app = render(
      createElement(VisibleWatchApp, {
        registry,
        delegationId,
        pollIntervalMs,
        onTerminal: () => {
          if (!resolved) {
            resolved = true;
            resolve();
            app.unmount();
          }
        },
      }),
      { exitOnCtrlC: true },
    );

    if (isTerminalStatus(initial.record.status) && !resolved) {
      resolved = true;
      resolve();
      app.unmount();
    }

    app.waitUntilExit().catch((error: unknown) => {
      if (!resolved) {
        resolved = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export async function watchDelegation(
  registry: DelegationRegistry,
  delegationId: string,
  options: WatchRuntimeOptions & { headless?: boolean; visible?: boolean } = {},
): Promise<void> {
  const mode: WatchMode =
    options.visible === true
      ? "visible"
      : options.headless === true || !process.stdout.isTTY
        ? "headless"
        : "visible";

  if (mode === "visible") {
    await watchVisible(registry, delegationId, options);
    return;
  }

  await watchHeadless(registry, delegationId, options);
}
