---
name: fabrica-delegate
description: Learn and operate the `fabrica-delegate` CLI: commands, delegation lifecycle/state, provider selection (OpenCode, Claude Code), isolated workspaces, and inspection workflows.
---

# fabrica-delegate

Use this skill when you need to operate `fabrica-delegate` without reading source code.
It is a control plane for delegating work to local coding agents, not a full agent launcher.

## What it does

`fabrica-delegate` tracks delegations in SQLite, provisions an isolated workspace per delegation, and hands execution to a provider adapter.
The CLI stays responsible for orchestration and state; the provider does the coding.

## Global options

- `--db <path>`: registry database location
- `--workspace-root <path>`: root for isolated workspaces

Defaults come from the environment when set:

- `FABRICA_DELEGATE_DB`
- `FABRICA_WORKSPACE_ROOT`

## Implemented commands

### `create`

Create a delegation record and provision an isolated workspace.

```bash
fabrica-delegate create --summary "Triage issue #27"
```

Useful flags:

- `--identity <identity>`
- `--status <status>`
- `--scope <scope>`
- `--provider <provider>`
- `--summary <summary>`
- `--metadata <json>`

Provider selection happens here.
Use `opencode` or `claude-code` for the provider name.
`create` defaults to `opencode`.

Example:

```bash
fabrica-delegate create \
  --provider claude-code \
  --summary "Implement issue #27" \
  --metadata '{"issue":27}'
```

### `start <delegation-id>`

Start the provider inside the delegation workspace.
This records the lifecycle transition and launches the configured local command.

```bash
fabrica-delegate start <delegation-id>
```

### `resume <delegation-id>`

Resume a stopped or failed delegation in the same workspace.
This reuses the existing workspace instead of creating a new one.

```bash
fabrica-delegate resume <delegation-id>
```

### `stop <delegation-id>`

Stop a running delegation and persist the final stopped state.

```bash
fabrica-delegate stop <delegation-id>
```

### `attach <delegation-id>`

Attach to a running delegation when the provider supports live sessions.

```bash
fabrica-delegate attach <delegation-id>
```

Gotcha: attach is capability-gated. If the provider does not implement `attach`, the CLI reports that clearly.

### `watch <delegation-id>`

Watch the persisted event stream.

```bash
fabrica-delegate watch <delegation-id> --headless
```

Flags:

- `--headless`: print only important transitions and errors
- `--visible`: render the live TUI
- `--poll-interval <ms>`: polling interval in milliseconds

### `result <delegation-id>`

Print the final result for a completed or stopped delegation.

```bash
fabrica-delegate result <delegation-id>
```

### `show <delegation-id>`

Show the delegation record plus its lifecycle events.

```bash
fabrica-delegate show <delegation-id>
```

### `list`

List recorded delegations.

```bash
fabrica-delegate list
```

### `fanout`

Launch the same task across multiple providers and compare results.
Provide at least two providers, either by repeating the flag or using commas.

```bash
fabrica-delegate fanout \
  --provider opencode \
  --provider claude-code \
  --summary "Compare providers for issue #27"
```

### `replay <delegation-id>`

Reconstruct the stored event stream for inspection.

```bash
fabrica-delegate replay <delegation-id>
```

## Lifecycle and state model

Each delegation is stored as a record with:

- identity, scope, provider, summary, metadata
- workspace reference
- current status
- final result, when available
- lifecycle events

Typical transitions are:

- `queued` -> `started` -> `preparing` -> `running`
- `running` -> `stopped`
- `running` -> `failed`
- `running` -> `completed`

The registry also records a final result payload when a delegation finishes or is stopped.
That result includes exit code, summary, metadata, and artifact paths.

Use `show` to inspect the record and `replay` to inspect the event history.
Use `result` when you only need the final outcome.

## Workspace model

Every delegation gets its own isolated workspace path.
The manager prefers `git worktree add --detach` when Git can create a worktree; otherwise it falls back to a plain directory.

Default workspace roots are derived from the repo name under `~/.fabrica/workspaces/`, unless `--workspace-root` or `FABRICA_WORKSPACE_ROOT` overrides it.

Practical rule: keep agent edits inside the delegation workspace, not the main checkout.

## Supported providers

Current provider names:

- `opencode` for OpenCode
- `claude-code` for Claude Code

Selection rules:

- choose the provider at `create` time
- `start` and `resume` use the recorded provider
- `fanout` can launch multiple providers for the same task

Both adapters run the local provider command inside the workspace.

## Gotchas

- Missing provider command on `PATH` will fail at launch time.
- `attach` may be a no-op if the provider does not support live sessions.
- `watch --headless` suppresses noisy nonessential events; `--visible` opens the TUI.
- `resume` reuses the same workspace, so any files left there remain visible.
- The default registry lives at `.fabrica/delegations.sqlite3` unless overridden.
- If worktree creation fails, the CLI still provisions a dedicated directory, so workspace isolation remains per delegation.
