import { Command } from "commander";
import { DelegationRegistry } from "./registry.js";

const VERSION = "0.1.0";
const DEFAULT_IDENTITY = "factory-agent";
const DEFAULT_STATUS = "queued";
const DEFAULT_SCOPE = "repository";
const DEFAULT_PROVIDER = "github";
const DEFAULT_SUMMARY = "Delegation created via fabrica-delegate create.";

interface CreateOptions {
  identity?: string;
  status?: string;
  scope?: string;
  provider?: string;
  workspaceReference?: string;
  summary?: string;
  metadata?: string;
}

function parseMetadata(metadata?: string): Record<string, unknown> {
  if (metadata === undefined || metadata.trim() === "") {
    return {};
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
    .description("Delegation registry CLI with SQLite persistence.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program
    .option("--db <path>", "path to the delegation registry database")
    .command("create")
    .description("Create a delegation record and persist it to SQLite.")
    .option("--identity <identity>", "delegation identity", DEFAULT_IDENTITY)
    .option("--status <status>", "delegation status", DEFAULT_STATUS)
    .option("--scope <scope>", "delegation scope", DEFAULT_SCOPE)
    .option("--provider <provider>", "provider name", DEFAULT_PROVIDER)
    .option("--workspace-reference <path>", "workspace reference", process.cwd())
    .option("--summary <summary>", "summary metadata", DEFAULT_SUMMARY)
    .option("--metadata <json>", "extra JSON metadata for the record")
    .action((options: CreateOptions, command: Command) => {
      const parent = command.parent;
      const db = program.opts<{ db?: string }>().db;
      const registry = openRegistry(db);
      const created = registry.create({
        identity: options.identity ?? DEFAULT_IDENTITY,
        status: options.status ?? DEFAULT_STATUS,
        scope: options.scope ?? DEFAULT_SCOPE,
        provider: options.provider ?? DEFAULT_PROVIDER,
        workspaceReference: options.workspaceReference ?? process.cwd(),
        summary: options.summary ?? DEFAULT_SUMMARY,
        metadata: parseMetadata(options.metadata),
      });

      console.log(`Created delegation ${created.delegationId}`);
      console.log(`  status: ${created.status}`);
      console.log(`  provider: ${created.provider}`);
      console.log(`  workspace: ${created.workspaceReference}`);
      console.log(`  summary: ${created.summary}`);
      registry.close();
    });

  program
    .command("list")
    .description("List delegations stored in SQLite.")
    .action((_: unknown, command: Command) => {
      const parent = command.parent;
      const db = program.opts<{ db?: string }>().db;
      const registry = openRegistry(db);
      printList(registry);
      registry.close();
    });

  program
    .command("show")
    .argument("<delegation-id>", "delegation identifier")
    .description("Show a delegation and its lifecycle events.")
    .action((delegationId: string, command: Command) => {
      const parent = command.parent;
      const db = program.opts<{ db?: string }>().db;
      const registry = openRegistry(db);
      printShow(registry, delegationId);
      registry.close();
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}
