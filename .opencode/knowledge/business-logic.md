# Business logic

The delegation lifecycle is the core business model.
A delegation represents one unit of work handed to a provider inside an isolated workspace.

## Lifecycle

A typical delegation moves through these states:

- `queued` — created and waiting to start
- `preparing` — workspace and runtime setup are in progress
- `running` — provider process is active
- `stopped` — the run was intentionally halted
- `completed` — the provider finished successfully
- `failed` — the run ended with an error

## State model rules

- State changes must be explicit and durable.
- The registry is the source of truth for the current state.
- Events should explain why a transition happened.
- A delegation may have one or more artifacts, summaries, or notes attached to the final result.
- Restart, resume, and attach flows must preserve the original delegation identity.

## Delegation responsibilities

The control plane is responsible for:

- creating the delegation record
- provisioning isolation for the work
- starting the selected provider
- recording lifecycle events
- surfacing the final result and artifacts

The provider is responsible for the actual coding session; the control plane only coordinates and records.

## Result model

When a delegation ends, the registry should preserve:

- final status
- exit information when available
- summary or handoff text
- artifact references
- enough history to replay or inspect the run later
