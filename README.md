# fabrica-delegate-cli

`fabrica-delegate` is a control plane for delegating work to coding agents.
It is **not** a launcher that owns the whole agent experience end to end.
Instead, it keeps three concerns separate:

- a delegation registry that records lifecycle state and results
- an isolated workspace manager that provisions per-delegation worktrees
- provider adapters that know how to start or attach to a specific coding agent

That separation matters because the CLI is meant to coordinate work, inspect state, and hand off to providers cleanly.
The executable is the control surface; the provider is where the coding happens.

## Installation and run

### Prerequisites

- [Bun](https://bun.sh/) 1.x
- Git
- A supported provider command on your `PATH`:
  - `opencode` for OpenCode
  - `claude` for Claude Code

### Install dependencies

```bash
bun install
```

### Run from source

```bash
bun run start -- --help
```

### Build a standalone binary

The project ships as a compiled Bun executable:

```bash
bun run build
./dist/fabrica-delegate --help
```

The build script runs type checking, linting, and then compiles a standalone binary with:

```bash
bun build --compile --outfile dist/fabrica-delegate src/index.ts
```

## Command reference

Global options:

- `--db <path>`: path to the delegation registry database
- `--workspace-root <path>`: root directory for isolated workspaces

### `create`

Create a delegation record and provision an isolated workspace.

```bash
fabrica-delegate create \
  --identity factory-agent \
  --provider opencode \
  --scope repository \
  --summary "Triage issue #22"
```

Useful flags:

- `--identity <identity>`
- `--status <status>`
- `--scope <scope>`
- `--provider <provider>`
- `--summary <summary>`
- `--metadata <json>`

Example with metadata:

```bash
fabrica-delegate create \
  --metadata '{"issue":22,"artifacts":[{"path":"README.md","kind":"doc"}]}'
```

### `start`

Start a delegation and launch the configured provider inside its workspace.

```bash
fabrica-delegate start <delegation-id>
```

Example:

```bash
fabrica-delegate start 0f6c7b3b-4a66-4d58-bc5e-1f2a5f64f8cc
```

### `stop`

Stop a running delegation and persist the final stopped state.

```bash
fabrica-delegate stop <delegation-id>
```

### `attach`

Attach to a running delegation when the provider supports live sessions.

```bash
fabrica-delegate attach <delegation-id>
```

If the provider does not expose attach support, the CLI reports that clearly.

### `list`

List delegations stored in SQLite.

```bash
fabrica-delegate list
```

### `show`

Show a delegation, including its lifecycle events.

```bash
fabrica-delegate show <delegation-id>
```

### `result`

Show the final result for a delegation, including exit code, summary, and artifacts.

```bash
fabrica-delegate result <delegation-id>
```

### `watch`

Watch a delegation's live state from the persisted event stream.

```bash
fabrica-delegate watch <delegation-id>
```

Flags:

- `--headless`: print only important transitions and errors
- `--visible`: render the live TUI
- `--poll-interval <ms>`: set the polling interval in milliseconds

Examples:

```bash
fabrica-delegate watch <delegation-id> --headless
fabrica-delegate watch <delegation-id> --visible
fabrica-delegate watch <delegation-id> --poll-interval 500
```

## Architecture

The CLI is intentionally split along three seams.

### 1) Delegation registry

The registry is the source of truth for delegation state.
It stores the delegation record, lifecycle events, workspace reference, and final result.

Current behavior:

- records delegation metadata in SQLite
- persists lifecycle transitions such as `queued`, `started`, `preparing`, `running`, `stopped`, and `failed`
- stores the final result payload and artifact list when a delegation completes or is stopped

### 2) Workspace manager

The workspace manager owns per-delegation isolation.
It provisions a dedicated worktree or workspace path for each delegation so agent work stays separated from the main checkout.

Current behavior:

- resolves the repository root from Git
- creates an isolated workspace path per delegation id
- prefers `git worktree add --detach` when available
- falls back to a directory when a worktree cannot be created

### 3) Provider adapter interface

Providers are plugged in through a small adapter interface.
The service asks the adapter to start work inside the workspace, and optionally to attach to a live session.

Interface shape:

- `start(context)` launches the provider
- `attach(context)` is optional and only used when live attachment is supported

This keeps `fabrica-delegate` focused on orchestration instead of hard-coding provider behavior.

## Supported providers

The repository currently includes adapters for:

- **OpenCode** — provider name: `opencode`
- **Claude Code** — provider name: `claude-code`

Both adapters spawn the corresponding local command in the delegation workspace.

## Roadmap / phase-2 status

Phase 1 of the control plane is implemented: create delegations, provision isolated workspaces, start and stop provider runs, inspect events, and read final results.

Phase 2 is the next layer of orchestration and is still a roadmap item. The likely focus is:

- richer live session handling and attachment flows
- better event replay and status surfacing
- more explicit artifact reporting and handoff metadata
- broader provider orchestration patterns beyond a single provider launch
- UX polish around watch / inspect flows

The main point: the project is evolving into a control plane, not into a bigger launcher.
