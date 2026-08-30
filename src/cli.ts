import { Command } from "commander";
import { DelegationService } from "./delegation-service.js";
import { DelegationRegistry } from "./registry.js";
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
  let workspaceManager: WorkspaceManager;

  if (workspaceRoot === undefined) {
    workspaceManager = new WorkspaceManager();
  } else {
    workspaceManager = new WorkspaceManager({ workspacesRoot: workspaceRoot });
  }

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
    .option("--provider <provider>", "provider name", "github")
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
        const request: CreateDelegationServiceRequest = {};

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
    .description("Start a delegation and ensure its workspace exists.")
    .action((delegationId: string) => {
      const { db, workspaceRoot } = program.opts<{ db?: string; workspaceRoot?: string }>();
      const { registry, service } = openService(db, workspaceRoot);

      try {
        const started = service.startDelegation(delegationId);
        console.log(`Started delegation ${started.delegationId}`);
        console.log(`  workspace: ${started.workspaceReference}`);
        console.log(`  status: ${started.status}`);
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

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}

interface CreateDelegationServiceRequest {
  identity?: string;
  status?: string;
  scope?: string;
  provider?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}
