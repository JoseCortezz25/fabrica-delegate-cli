# Folder structure

Keep the repository layout flat and CLI-oriented.

## Current shape

- `src/index.ts` — executable entry point
- `src/cli.ts` — command parsing and CLI wiring
- `src/registry.ts` — SQLite-backed delegation registry
- `src/workspace-manager.ts` — isolated worktree/workspace handling
- `src/provider-adapters.ts` — provider adapter contracts and selection
- `src/opencode-adapter.ts` — OpenCode provider adapter
- `src/claude-code-adapter.ts` — Claude Code provider adapter
- `src/delegation-service.ts` — orchestration across registry, workspace, and providers
- `src/watch.ts` — live state watching
- `src/replay.ts` — event replay and history inspection

## Rules

- Keep the root `src/` directory flat unless a new concern clearly justifies a subfolder.
- Group by seam, not by UI surface.
- Add new provider adapters alongside the existing adapter files.
- Keep persistence, workspace, and watch/replay logic separate.
- Avoid React-style folders such as `components/`, `pages/`, `app/`, `styles/`, or `stories/`.

The layout should make the control plane easy to navigate for CLI and automation work.