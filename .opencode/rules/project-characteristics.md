# Project characteristics

This project is a Bun-powered TypeScript CLI for delegating work to coding agents.

## Characteristics

- Runtime: Bun.
- Language: strict TypeScript.
- Persistence: SQLite for delegation state and results.
- Execution model: event-driven lifecycle tracking with persisted state.
- Architecture: provider-agnostic adapter model.
- Workspace model: isolated Git worktrees or workspaces per delegation.
- User interface: CLI-first control plane, not a web app.

## Architecture cues

- The CLI coordinates work; providers do the coding.
- Adapters encapsulate provider-specific start/attach behavior.
- Registry, workspace management, watching, and replay are separate concerns.
- Keep the implementation portable across provider backends.

Do not introduce React/UI patterns or template assumptions that do not fit a Bun CLI.