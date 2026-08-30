import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DelegationMetadata {
  [key: string]: unknown;
}

export interface DelegationArtifact {
  path: string;
  kind?: string;
  description?: string;
}

export interface DelegationFinalResult {
  delegationId: string;
  status: string;
  exitCode: number;
  summary: string;
  metadata: DelegationMetadata;
  artifacts: DelegationArtifact[];
  workspaceReference: string;
  recordedAt: string;
  sourceEventId: number;
}

export interface CreateDelegationInput {
  delegationId?: string;
  identity: string;
  status: string;
  scope: string;
  provider: string;
  workspaceReference: string;
  summary: string;
  metadata?: DelegationMetadata;
}

export interface DelegationEvent {
  eventId: number;
  delegationId: string;
  eventType: string;
  payload: DelegationMetadata;
  createdAt: string;
}

export interface DelegationRecord {
  delegationId: string;
  identity: string;
  status: string;
  scope: string;
  provider: string;
  workspaceReference: string;
  summary: string;
  metadata: DelegationMetadata;
  createdAt: string;
  updatedAt: string;
  result: DelegationFinalResult | null;
  events: DelegationEvent[];
}

export interface DelegationSummary {
  delegationId: string;
  identity: string;
  status: string;
  scope: string;
  provider: string;
  workspaceReference: string;
  summary: string;
  metadata: DelegationMetadata;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  lastEventAt: string | null;
}

interface DelegationRow {
  delegation_id: string;
  identity: string;
  status: string;
  scope: string;
  provider: string;
  workspace_reference: string;
  summary: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_id: number;
  delegation_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

interface DelegationSummaryRow extends DelegationRow {
  event_count: number;
  last_event_at: string | null;
}

const DEFAULT_DB_PATH = ".fabrica/delegations.sqlite3";

export function resolveRegistryPath(dbPath?: string): string {
  const configured = process.env.FABRICA_DELEGATE_DB ?? dbPath ?? DEFAULT_DB_PATH;
  return resolve(process.cwd(), configured);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseJsonObject(value: string): DelegationMetadata {
  const parsed = parseJson<unknown>(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadata must be a JSON object");
  }

  return parsed as DelegationMetadata;
}

function parseArtifacts(value: unknown): DelegationArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((artifact) => {
    if (artifact === null || typeof artifact !== "object") {
      return [];
    }

    const candidate = artifact as Record<string, unknown>;
    const path = candidate.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return [];
    }

    const normalized: DelegationArtifact = { path };
    if (typeof candidate.kind === "string" && candidate.kind.trim().length > 0) {
      normalized.kind = candidate.kind;
    }
    if (typeof candidate.description === "string" && candidate.description.trim().length > 0) {
      normalized.description = candidate.description;
    }

    return [normalized];
  });
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class DelegationRegistry {
  private readonly database: Database;

  constructor(dbPath?: string) {
    const resolvedPath = resolveRegistryPath(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new Database(resolvedPath, { create: true });
    this.initialize();
  }

  private initialize(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS delegations (
        delegation_id TEXT PRIMARY KEY,
        identity TEXT NOT NULL,
        status TEXT NOT NULL,
        scope TEXT NOT NULL,
        provider TEXT NOT NULL,
        workspace_reference TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delegation_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        delegation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (delegation_id) REFERENCES delegations(delegation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_delegation_events_delegation_id
        ON delegation_events(delegation_id, created_at);
    `);
  }

  create(input: CreateDelegationInput): DelegationRecord {
    const delegationId = input.delegationId ?? randomUUID();
    const createdAt = nowIso();
    const metadata = input.metadata ?? {};
    const serializedMetadata = JSON.stringify(metadata);

    this.database.exec("BEGIN");
    try {
      this.database
        .query(
          `INSERT INTO delegations (
          delegation_id,
          identity,
          status,
          scope,
          provider,
          workspace_reference,
          summary,
          metadata_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        )
        .run(
          delegationId,
          input.identity,
          input.status,
          input.scope,
          input.provider,
          input.workspaceReference,
          input.summary,
          serializedMetadata,
          createdAt,
          createdAt,
        );

      this.recordEvent(
        delegationId,
        "created",
        {
          delegationId,
          identity: input.identity,
          status: input.status,
          scope: input.scope,
          provider: input.provider,
          workspaceReference: input.workspaceReference,
          summary: input.summary,
          metadata,
        },
        createdAt,
      );

      this.database.exec("COMMIT");
      const created = this.show(delegationId);
      if (created === null) {
        throw new Error("delegation was written but could not be read back");
      }

      return created;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateWorkspaceReference(delegationId: string, workspaceReference: string): DelegationRecord {
    const updatedAt = nowIso();

    this.database.exec("BEGIN");
    try {
      const result = this.database
        .query(
          `UPDATE delegations
           SET workspace_reference = ?, updated_at = ?
           WHERE delegation_id = ?;`,
        )
        .run(workspaceReference, updatedAt, delegationId);

      if (result.changes === 0) {
        throw new Error(`Delegation not found: ${delegationId}`);
      }

      this.recordEvent(
        delegationId,
        "workspace_updated",
        { delegationId, workspaceReference },
        updatedAt,
      );

      this.database.exec("COMMIT");
      const updated = this.show(delegationId);
      if (updated === null) {
        throw new Error("delegation was updated but could not be read back");
      }

      return updated;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordLifecycleEvent(
    delegationId: string,
    status: string,
    eventType: string,
    payload: DelegationMetadata,
  ): DelegationRecord {
    const createdAt = nowIso();

    this.database.exec("BEGIN");
    try {
      const result = this.database
        .query(
          `UPDATE delegations
           SET status = ?, updated_at = ?
           WHERE delegation_id = ?;`,
        )
        .run(status, createdAt, delegationId);

      if (result.changes === 0) {
        throw new Error(`Delegation not found: ${delegationId}`);
      }

      this.recordEvent(delegationId, eventType, payload, createdAt);
      this.database.exec("COMMIT");

      const updated = this.show(delegationId);
      if (updated === null) {
        throw new Error("delegation was updated but could not be read back");
      }

      return updated;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  list(): DelegationSummary[] {
    const rows = this.database
      .query<DelegationSummaryRow>(`
      SELECT
        d.delegation_id,
        d.identity,
        d.status,
        d.scope,
        d.provider,
        d.workspace_reference,
        d.summary,
        d.metadata_json,
        d.created_at,
        d.updated_at,
        COUNT(e.event_id) AS event_count,
        MAX(e.created_at) AS last_event_at
      FROM delegations AS d
      LEFT JOIN delegation_events AS e
        ON e.delegation_id = d.delegation_id
      GROUP BY
        d.delegation_id,
        d.identity,
        d.status,
        d.scope,
        d.provider,
        d.workspace_reference,
        d.summary,
        d.metadata_json,
        d.created_at,
        d.updated_at
      ORDER BY d.created_at DESC;
    `)
      .all();

    return rows.map((row) => ({
      delegationId: row.delegation_id,
      identity: row.identity,
      status: row.status,
      scope: row.scope,
      provider: row.provider,
      workspaceReference: row.workspace_reference,
      summary: row.summary,
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      eventCount: row.event_count,
      lastEventAt: row.last_event_at,
    }));
  }

  show(delegationId: string): DelegationRecord | null {
    const row = this.database
      .query<DelegationRow>(
        `SELECT
        delegation_id,
        identity,
        status,
        scope,
        provider,
        workspace_reference,
        summary,
        metadata_json,
        created_at,
        updated_at
      FROM delegations
      WHERE delegation_id = ?;`,
      )
      .get(delegationId);

    if (row == null) {
      return null;
    }

    const events = this.listEvents(delegationId);

    return {
      delegationId: row.delegation_id,
      identity: row.identity,
      status: row.status,
      scope: row.scope,
      provider: row.provider,
      workspaceReference: row.workspace_reference,
      summary: row.summary,
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      result: this.extractFinalResult({
        delegationId: row.delegation_id,
        workspaceReference: row.workspace_reference,
        status: row.status,
        summary: row.summary,
        metadataJson: row.metadata_json,
        events,
      }),
      events,
    };
  }

  recordFinalResult(
    delegationId: string,
    payload: {
      exitCode: number;
      summary?: string;
      artifacts?: DelegationArtifact[];
      metadata?: DelegationMetadata;
      status?: string;
      sourceEventType?: string;
    },
  ): DelegationRecord {
    const recordedAt = nowIso();
    const normalizedArtifacts = payload.artifacts ?? [];

    this.database.exec("BEGIN");
    try {
      const result = this.database
        .query(
          `UPDATE delegations
           SET updated_at = ?
           WHERE delegation_id = ?;`,
        )
        .run(recordedAt, delegationId);

      if (result.changes === 0) {
        throw new Error(`Delegation not found: ${delegationId}`);
      }

      this.recordEvent(
        delegationId,
        payload.sourceEventType ?? "result",
        {
          delegationId,
          status: payload.status,
          exitCode: payload.exitCode,
          summary: payload.summary,
          metadata: payload.metadata ?? {},
          artifacts: normalizedArtifacts,
          recordedAt,
        },
        recordedAt,
      );

      this.database.exec("COMMIT");
      const updated = this.show(delegationId);
      if (updated === null) {
        throw new Error("delegation was updated but could not be read back");
      }

      return updated;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  private recordEvent(
    delegationId: string,
    eventType: string,
    payload: DelegationMetadata,
    createdAt: string,
  ): void {
    this.database
      .query(
        `INSERT INTO delegation_events (
          delegation_id,
          event_type,
          payload_json,
          created_at
        ) VALUES (?, ?, ?, ?);`,
      )
      .run(delegationId, eventType, JSON.stringify(payload), createdAt);
  }

  private listEvents(delegationId: string): DelegationEvent[] {
    const rows = this.database
      .query<EventRow>(`
      SELECT
        event_id,
        delegation_id,
        event_type,
        payload_json,
        created_at
      FROM delegation_events
      WHERE delegation_id = ?
      ORDER BY event_id ASC;
    `)
      .all(delegationId);

    return rows.map((row) => ({
      eventId: row.event_id,
      delegationId: row.delegation_id,
      eventType: row.event_type,
      payload: parseJsonObject(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  private extractFinalResult(input: {
    delegationId: string;
    workspaceReference: string;
    status: string;
    summary: string;
    metadataJson: string;
    events: DelegationEvent[];
  }): DelegationFinalResult | null {
    for (let index = input.events.length - 1; index >= 0; index -= 1) {
      const event = input.events[index];
      if (event?.eventType !== "result") {
        continue;
      }

      const payload = event.payload as Record<string, unknown>;
      const exitCode = asPositiveInteger(payload.exitCode);
      if (exitCode === null) {
        continue;
      }

      return {
        delegationId: input.delegationId,
        status:
          typeof payload.status === "string" && payload.status.trim().length > 0
            ? payload.status
            : input.status,
        exitCode,
        summary:
          typeof payload.summary === "string" && payload.summary.trim().length > 0
            ? payload.summary
            : input.summary,
        metadata: parseJsonObject(input.metadataJson),
        artifacts: parseArtifacts(payload.artifacts),
        workspaceReference: input.workspaceReference,
        recordedAt:
          typeof payload.recordedAt === "string" && payload.recordedAt.trim().length > 0
            ? payload.recordedAt
            : event.createdAt,
        sourceEventId: event.eventId,
      };
    }

    return null;
  }
}
