import { spawn } from "node:child_process";
import type {
  DelegationLaunchContext,
  DelegationLaunchResult,
  DelegationProviderAdapter,
} from "./provider-adapters.js";

export interface OpenCodeAdapterOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export class OpenCodeAdapter implements DelegationProviderAdapter {
  readonly provider = "opencode";

  constructor(private readonly options: OpenCodeAdapterOptions = {}) {}

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    const command = this.options.command ?? "opencode";
    const args = [...(this.options.args ?? []), "run", context.summary];

    return await new Promise<DelegationLaunchResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: context.workspaceReference,
        env: {
          ...process.env,
          ...this.options.env,
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const emitOutput = (eventType: string, chunk: Buffer): void => {
        const text = chunk.toString("utf8");
        if (text.trim().length === 0) {
          return;
        }

        context.emitEvent?.(eventType, {
          delegationId: context.delegationId,
          stream: eventType,
          chunk: text,
        });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        emitOutput("provider_stdout", chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        emitOutput("provider_stderr", chunk);
      });

      child.once("error", (error) => {
        reject(error);
      });

      child.once("spawn", () => {
        if (child.pid == null) {
          reject(new Error("OpenCode adapter failed to create a child process"));
          return;
        }

        child.unref();
        resolve({
          provider: this.provider,
          command,
          args,
          pid: child.pid,
          workspaceReference: context.workspaceReference,
          startedAt: new Date().toISOString(),
        });
      });
    });
  }
}
