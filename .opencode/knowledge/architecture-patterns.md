# Architecture patterns

The control plane is organized around three seams and one event stream.

## 1) Delegation registry

The registry owns the canonical delegation record.
It stores the current state, metadata, workspace reference, provider choice, and final result.

Use the registry for:

- creating delegation records
- advancing lifecycle state
- storing snapshots and outcome data
- replaying or inspecting historical events

## 2) Workspace manager

The workspace manager isolates each delegation in its own workspace or git worktree.
It is responsible for locating the repository root and provisioning a safe execution area for the agent.

Use the workspace manager for:

- creating per-delegation isolation
- resolving the checkout root
- tracking workspace paths and cleanup boundaries

## 3) Provider adapter interface

Provider adapters encapsulate provider-specific launch and attach behavior.
The control plane should speak through a small interface and never hard-code provider internals into orchestration logic.

Use the adapter seam for:

- starting a delegation run
- attaching to a running session when supported
- translating provider-specific capabilities into control-plane events

## 4) Event stream

Every meaningful transition should be recorded as an event.
The live CLI, replay commands, and watch mode consume the event stream rather than guessing from process state.

The event model should support:

- queued → preparing → running → stopped/failed/completed
- attach and resume events where supported
- replay and inspection without depending on live provider state

## Operating modes

- **Headless mode**: emit concise state transitions and results for automation.
- **Visible mode**: render live progress in Ink while still writing the same underlying events.

The modes differ only in presentation; they must not diverge in stored state.
