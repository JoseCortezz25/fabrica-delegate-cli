---
name: typescript
description: TypeScript workflow for this repository: types, Bun tooling, tsconfig-aware fixes, and keeping the CLI buildable and testable.
---

# TypeScript

Use this skill when editing TypeScript in `src/` or `test/`.

## Repo-specific defaults

- Runtime/build tool: Bun
- Type check: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun test`
- Build: `bun run build`

## What to optimize for

- Keep types explicit at module boundaries.
- Prefer small, local fixes over wide refactors.
- Preserve ESM compatibility (`"type": "module"`).
- Keep test helpers typed enough to catch regressions without adding noise.

## Good habits

- Run `bun run typecheck` after changes that touch exports, generics, or shared types.
- Use `unknown` instead of `any` unless the boundary is genuinely dynamic.
- Match existing project conventions before introducing a new abstraction.
- Keep compile-time and runtime behavior aligned; don’t fix TypeScript errors by weakening the API.

## When in doubt

If a TypeScript change affects the CLI entrypoint, run the repo’s real checks in this order:

1. `bun run typecheck`
2. `bun run lint`
3. `bun test`
