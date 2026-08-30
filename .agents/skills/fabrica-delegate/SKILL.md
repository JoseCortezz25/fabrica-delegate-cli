---
name: fabrica-delegate
description: Learn and operate the fabrica-delegate CLI: commands, delegation lifecycle/state, isolated workspaces, provider selection, and inspection workflows.
---

# fabrica-delegate

Use this skill when you need to operate `fabrica-delegate` without reading source code.

## What it covers

- delegation registry state and lifecycle
- isolated workspace provisioning
- provider adapters for OpenCode and Claude Code
- inspection commands like `show`, `watch`, `replay`, and `result`

## Repo-specific commands

- `bun run typecheck`
- `bun run lint`
- `bun test`
- `bun run build`

## Operating rules

- Keep agent edits inside the delegation workspace.
- Treat the registry as the source of truth for delegation state.
- Prefer `show` and `result` when you need facts from the registry.
- Use `watch` for live state changes and `replay` for event history.

## Supported providers

- `opencode`
- `claude-code`

## Practical guidance

The CLI is the control plane; the provider does the coding.
This skill should stay focused on orchestration, isolation, and inspection.
