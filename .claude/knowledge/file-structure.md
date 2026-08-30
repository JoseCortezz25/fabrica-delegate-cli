# File structure

This repository is organized as a small Bun/TypeScript CLI with tests alongside the runtime modules.

## Runtime layout

- `src/index.ts` — package entrypoint
- `src/cli.ts` — commander command wiring
- `src/delegation-service.ts` — orchestration and lifecycle coordination
- `src/registry.ts` — SQLite-backed delegation registry
- `src/workspace-manager.ts` — isolated workspace/worktree management
- `src/provider-adapters.ts` — provider adapter interfaces and selection logic
- `src/opencode-adapter.ts` — OpenCode integration
- `src/claude-code-adapter.ts` — Claude Code integration
- `src/watch.ts` — live/headless watch logic and event streaming
- `src/replay.ts` — event replay helpers
- `src/types/bun-sqlite.d.ts` — Bun SQLite typings

## Test layout

- `test/registry.test.ts`
- `test/workspace-manager.test.ts`
- `test/delegation-service.test.ts`
- `test/opencode-adapter.test.ts`
- `test/claude-code-adapter.test.ts`
- `test/watch.test.ts`
- `test/replay`-style CLI coverage in the `test/cli-*.test.ts` files

## Conventions

- Keep implementation code in `src/`.
- Keep behavioral coverage in `test/`.
- Keep the knowledge layer close to the repo root in provider-specific mirrors under `.opencode/knowledge/` and `.claude/knowledge/`.
- Treat the knowledge files as documentation for the control plane, not as generated output.
