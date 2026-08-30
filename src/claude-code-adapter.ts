import { spawn } from "node:child_process";
import type {
  DelegationLaunchContext,
  DelegationLaunchResult,
  DelegationProviderAdapter,
} from "./provider-adapters.js";

export interface ClaudeCodeAdapterOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export class ClaudeCodeAdapter implements DelegationProviderAdapter {
  readonly provider = "claude-code";

  constructor(private readonly options: ClaudeCodeAdapterOptions = {}) {}

  async start(context: DelegationLaunchContext): Promise<DelegationLaunchResult> {
    const command = this.options.command ?? "claude";
    const args = [...(this.options.args ?? []), "-p", context.summary];

    return await new Promise<DelegationLaunchResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: context.workspaceReference,
        env: {
          ...process.env,
          ...this.options.env,
        },
        detached: true,
        stdio: "ignore",
      });

      child.once("error", (error) => {
        reject(error);
      });

      child.once("spawn", () => {
        if (child.pid == null) {
          reject(new Error("Claude Code adapter failed to create a child process"));
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
