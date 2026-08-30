import { Command } from "commander";
import {
  type CreateDelegationRequest,
  DelegationService,
  type FanoutDelegationRequest,
} from "./delegation-service.js";
import { DelegationRegistry } from "./registry.js";
import { printReplay } from "./replay.js";
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

interface FanoutOptions {
  identity?: string;
  status?: string;
  scope?: string;
  provider?: string[];
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

function collectProvider(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parseProviderList(values: string[] | undefined): string[] {
  const providers = (values ?? [])
    .flatMap((value) => value.split(","))
    .map((provider) => provider.trim())
    .filter((provider) => provider.length > 0);
  const uniqueProviders = [...new Set(providers)];

  if (uniqueProviders.length < 2) {
    throw new Error(
      "--provider must be supplied at least twice, or with at least two comma-separated providers",
    );
  }

  return uniqueProviders;
}

function printFanout(result: Awaited<ReturnType<DelegationService["fanOutDelegations"]>>): void {
  console.log(`Fan-out group ${result.groupId}`);
  console.log(`  summary: ${result.summary}`);
  console.table(
    result.entries.map((entry) => ({
      provider: entry.provider,
      delegation_id: entry.record.delegationId,
      status: entry.record.status,
      pid: entry.launch?.pid ?? null,
      workspace: entry.record.workspaceReference,
      command:
        entry.launch === null
          ? ""
          : `${entry.launch.command} ${entry.launch.args.join(" ")}`.trim(),
      error: entry.error ?? "",
    })),
  );
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
  if (record.result !== null) {
    console.log("  result:");
    console.log(`    exit_code: ${record.result.exitCode}`);
    console.log(`    status: ${record.result.status}`);
    console.log(`    summary: ${record.result.summary}`);
    console.log(`    recorded_at: ${record.result.recordedAt}`);
    console.log(`    artifacts: ${JSON.stringify(record.result.artifacts, null, 2)}`);
  }
  console.log("  events:");
  for (const event of record.events) {
    console.log(
      `    - [${event.createdAt}] ${event.eventType} #${event.eventId}: ${JSON.stringify(event.payload)}`,
    );
  }
}

function printResult(registry: DelegationRegistry, delegationId: string): void {
  const record = registry.show(delegationId);

  if (record === null) {
    throw new Error(`Delegation not found: ${delegationId}`);
  }

  if (record.result === null) {
    throw new Error(`No final result recorded for delegation ${delegationId}`);
  }

  const { result } = record;
  console.log(`Delegation ${record.delegationId} final result`);
  console.log(`  status: ${result.status}`);
  console.log(`  exit_code: ${result.exitCode}`);
  console.log(`  summary: ${result.summary}`);
  console.log(`  workspace: ${result.workspaceReference}`);
  console.log(`  recorded_at: ${result.recordedAt}`);
  console.log(`  metadata: ${JSON.stringify(result.metadata, null, 2)}`);
  console.log(`  artifacts: ${JSON.stringify(result.artifacts, null, 2)}`);
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
    .command("fanout")
    .description(
      "Launch the same task across multiple providers and compare the results side by side.",
    )
    .option("--identity <identity>", "delegation identity", "factory-agent")
    .option("--status <status>", "delegation status", "queued")
    .option("--scope <scope>", "delegation scope", "repository")
    .option("--provider <provider>", "provider name; repeat for fan-out", collectProvider, [])
    .option(
      "--summary <summary>",
      "summary metadata",
      "Delegation created via fabrica-delegate create.",
    )
    .option("--metadata <json>", "extra JSON metadata for the record")
    .action(async (options: FanoutOptions) => {
      const { db, workspaceRoot } = program.opts<{ db?: string; workspaceRoot?: string }>();
      const { registry, service } = openService(db, workspaceRoot);

      try {
        const metadata = parseMetadata(options.metadata);
        const request: FanoutDelegationRequest = {
          identity: options.identity,
          status: options.status,
          scope: options.scope,
          providers: parseProviderList(options.provider),
          summary: options.summary,
          metadata,
        };

        const fanout = await service.fanOutDelegations(request);
        printFanout(fanout);
      } finally {
        registry.close();
      }
    });

  program
    .command("resume")
    .argument("<delegation-id>", "delegation identifier")
    .description("Resume a stopped or failed delegation in its existing workspace.")
    .action(async (delegationId: string) => {
      const { db, workspaceRoot } = program.opts<{ db?: string; workspaceRoot?: string }>();
      const { registry, service } = openService(db, workspaceRoot);

      try {
        const resumed = await service.resumeDelegation(delegationId);
        console.log(`Resumed delegation ${resumed.record.delegationId}`);
        console.log(`  provider: ${resumed.record.provider}`);
        console.log(`  workspace: ${resumed.record.workspaceReference}`);
        console.log(`  status: ${resumed.record.status}`);
        console.log(`  pid: ${resumed.launch.pid}`);
        console.log(`  command: ${resumed.launch.command} ${resumed.launch.args.join(" ")}`.trim());
      } finally {
        registry.close();
      }
    });

  program
    .command("stop")
    .argument("<delegation-id>", "delegation identifier")
    .description("Stop a running delegation and persist the stopped state.")
    .action(async (delegationId: string) => {
      const { db } = program.opts<{ db?: string }>();
      const { registry, service } = openService(db);

      try {
        const stopped = await service.stopDelegation(delegationId);
        console.log(`Stopped delegation ${stopped.record.delegationId}`);
        console.log(`  status: ${stopped.record.status}`);
        if (stopped.pid !== null) {
          console.log(`  pid: ${stopped.pid}`);
        }
      } finally {
        registry.close();
      }
    });

  program
    .command("attach")
    .argument("<delegation-id>", "delegation identifier")
    .description("Attach to a running delegation when the provider supports live sessions.")
    .action(async (delegationId: string) => {
      const { db } = program.opts<{ db?: string }>();
      const { registry, service } = openService(db);

      try {
        const attached = await service.attachDelegation(delegationId);
        if (attached.attached) {
          console.log(attached.message);
          console.log(`  provider: ${attached.record.provider}`);
          console.log(`  pid: ${attached.pid ?? "unknown"}`);
          return;
        }

        console.log(attached.message);
        console.log(`  delegation: ${attached.record.delegationId}`);
        console.log(`  status: ${attached.record.status}`);
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
    .command("result")
    .argument("<delegation-id>", "delegation identifier")
    .description("Show the final result for a delegation.")
    .action((delegationId: string) => {
      const registry = openRegistry(program.opts<{ db?: string }>().db);
      try {
        printResult(registry, delegationId);
      } finally {
        registry.close();
      }
    });

  program
    .command("replay")
    .argument("<delegation-id>", "delegation identifier")
    .description("Reconstruct the persisted event stream for a delegation.")
    .action((delegationId: string) => {
      const registry = openRegistry(program.opts<{ db?: string }>().db);
      try {
        printReplay(registry, delegationId);
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
