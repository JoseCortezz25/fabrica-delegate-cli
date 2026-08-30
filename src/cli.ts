import { Command } from "commander";

const VERSION = "0.1.0";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("fabrica-delegate")
    .description("Bootstrap CLI for Fabrica delegation workflows.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program
    .command("issue")
    .argument("<number>", "GitHub issue number")
    .description("Inspect or start an issue workflow.")
    .action((issueNumber: string) => {
      console.log(`Issue workflow skeleton for #${issueNumber}.`);
    });

  program
    .command("pr")
    .argument("<number>", "GitHub pull request number")
    .description("Inspect or start a pull request workflow.")
    .action((prNumber: string) => {
      console.log(`Pull request workflow skeleton for #${prNumber}.`);
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}
