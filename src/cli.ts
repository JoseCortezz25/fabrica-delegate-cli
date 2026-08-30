import { Command } from "commander";
import { type CreateDelegationRequest, DelegationService } from "./delegation-service.js";
import { DelegationRegistry } from "./registry.js";
import { watchDelegation } from "./watch.js";
import { WorkspaceManager } from "./workspace-manager.js";

const VERSION = "0.1.0";

interface CreateOptions {
  identity?: string;
  status?: string;
  scope?: string;
  provider?: string;
  summary?: string;
  metadata?: string;
}

interface WatchOptions {
  headless?: boolean;
  visible?: boolean;
  pollInterval?: string;
}

function parseMetadata(metadata?: string): Record<string, unknown> | undefined {
  if (metadata === undefined || metadata.trim() === "") {
    return undefined;
  }

  const parsed = JSON.parse(metadata) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--metadata must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function openRegistry(dbPath?: string): DelegationRegistry {
  return new DelegationRegistry(dbPath);
}

function openService(
  dbPath?: string,
  workspaceRoot?: string,
): { registry: DelegationRegistry; service: DelegationService } {
  const registry = openRegistry(dbPath);
  const workspaceManager =
    workspaceRoot === undefined
      ? new WorkspaceManager()
      : new WorkspaceManager({ workspacesRoot: workspaceRoot });

  return {
    registry,
    service: new DelegationService(registry, workspaceManager),
  };
}

function printList(registry: DelegationRegistry): void {
  const items = registry.list();

  if (items.length === 0) {
    console.log("No delegations recorded yet.");
    return;
  }

  console.table(
    items.map((item) => ({
      delegation_id: item.delegationId,
      status: item.status,
      provider: item.provider,
      scope: item.scope,
      identity: item.identity,
      workspace: item.workspaceReference,
      event_count: item.eventCount,
      summary: item.summary,
    })),
  );
}

function printShow(registry: DelegationRegistry, delegationId: string): void {
  const record = registry.show(delegationId);

  if (record === null) {
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  console.log(`Delegation ${record.delegationId}`);
  console.log(`  identity: ${record.identity}`);
  console.log(`  status: ${record.status}`);
  console.log(`  scope: ${record.scope}`);
  console.log(`  provider: ${record.provider}`);
  console.log(`  workspace: ${record.workspaceReference}`);
  console.log(`  summary: ${record.summary}`);
  console.log(`  created_at: ${record.createdAt}`);
  console.log(`  updated_at: ${record.updatedAt}`);
  console.log(`  metadata: ${JSON.stringify(record.metadata, null, 2)}`);
  console.log("  events:");
  for (const event of record.events) {
    console.log(
      `    - [${event.createdAt}] ${event.eventType} #${event.eventId}: ${JSON.stringify(event.payload)}`,
    );
  }
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name("fabrica-delegate")
    .description("Delegation registry CLI with isolated workspaces.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program
    .option("--db <path>", "path to the delegation registry database")
    .option("--workspace-root <path>", "root directory for isolated workspaces");

  program
    .command("create")
    .description("Create a delegation record and provision an isolated workspace.")
    .option("--identity <identity>", "delegation identity", "factory-agent")
    .option("--status <status>", "delegation status", "queued")
    .option("--scope <scope>", "delegation scope", "repository")
    .option("--provider <provider>", "provider name", "opencode")
    .option(
      "--summary <summary>",
      "summary metadata",
      "Delegation created via fabrica-delegate create.",
    )
    .option("--metadata <json>", "extra JSON metadata for the record")
    .action((options: CreateOptions) => {
      const { db, workspaceRoot } = program.opts<{ db?: string; workspaceRoot?: string }>();
      const { registry, service } = openService(db, workspaceRoot);

      try {
        const request: CreateDelegationRequest = {};

        if (options.identity !== undefined) {
          request.identity = options.identity;
        }
        if (options.status !== undefined) {
          request.status = options.status;
        }
        if (options.scope !== undefined) {
          request.scope = options.scope;
        }
        if (options.provider !== undefined) {
          request.provider = options.provider;
        }
        if (options.summary !== undefined) {
          request.summary = options.summary;
        }

        const metadata = parseMetadata(options.metadata);
        const created = service.createDelegation(
          metadata === undefined ? request : { ...request, metadata },
        );

        console.log(`Created delegation ${created.delegationId}`);
        console.log(`  status: ${created.status}`);
        console.log(`  provider: ${created.provider}`);
        console.log(`  workspace: ${created.workspaceReference}`);
        console.log(`  summary: ${created.summary}`);
      } finally {
        registry.close();
      }
    });

  program
    .command("start")
    .argument("<delegation-id>", "delegation identifier")
    .description("Start a delegation and launch its provider inside the workspace.")
    .action(async (delegationId: string) => {
      const { db, workspaceRoot } = program.opts<{ db?: string; workspaceRoot?: string }>();
      const { registry, service } = openService(db, workspaceRoot);

      try {
        const started = await service.startDelegation(delegationId);
        console.log(`Started delegation ${started.record.delegationId}`);
        console.log(`  provider: ${started.record.provider}`);
        console.log(`  workspace: ${started.record.workspaceReference}`);
        console.log(`  status: ${started.record.status}`);
        console.log(`  pid: ${started.launch.pid}`);
        console.log(`  command: ${started.launch.command} ${started.launch.args.join(" ")}`.trim());
      } finally {
        registry.close();
      }
    });

  program
    .command("list")
    .description("List delegations stored in SQLite.")
    .action(() => {
      const registry = openRegistry(program.opts<{ db?: string }>().db);
      try {
        printList(registry);
      } finally {
        registry.close();
      }
    });

  program
    .command("show")
    .argument("<delegation-id>", "delegation identifier")
    .description("Show a delegation and its lifecycle events.")
    .action((delegationId: string) => {
      const registry = openRegistry(program.opts<{ db?: string }>().db);
      try {
        printShow(registry, delegationId);
      } finally {
        registry.close();
      }
    });

  program
    .command("watch")
    .argument("<delegation-id>", "delegation identifier")
    .description("Watch a delegation's live state from the persisted event stream.")
    .option("--headless", "print only important transitions and errors")
    .option("--visible", "render the live TUI")
    .option("--poll-interval <ms>", "poll interval in milliseconds", "250")
    .action(async (delegationId: string, options: WatchOptions) => {
      const { db } = program.opts<{ db?: string }>();
      const registry = openRegistry(db);

      try {
        const pollIntervalMs = Number.parseInt(options.pollInterval ?? "250", 10);
        if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
          throw new Error("--poll-interval must be a positive integer");
        }

        if (options.visible === true) {
          await watchDelegation(registry, delegationId, {
            visible: true,
            pollIntervalMs,
          });
        } else if (options.headless === true) {
          await watchDelegation(registry, delegationId, {
            headless: true,
            pollIntervalMs,
          });
        } else {
          await watchDelegation(registry, delegationId, {
            pollIntervalMs,
          });
        }
      } finally {
        registry.close();
      }
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}
