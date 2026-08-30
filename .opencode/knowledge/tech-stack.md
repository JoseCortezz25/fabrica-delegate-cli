# Tech stack

The delegation control plane is built with:

- **Bun** as the runtime, package manager, test runner, and compiler target
- **TypeScript** for all application code
- **SQLite** via `bun:sqlite` for the delegation registry and event persistence
- **commander** for the CLI command surface
- **Ink** for the optional TUI/watch experience
- **Biome** and **TypeScript** checks for local validation

## Canonical commands

- `bun test` — run the test suite
- `bun build --compile --outfile dist/fabrica-delegate src/index.ts` — compile the standalone CLI binary
- `bun run typecheck` — run `tsc --noEmit`
- `bun run lint` — run Biome checks over `src/` and `test/`

## Operational notes

- Keep the control plane runnable from source and as a compiled binary.
- Prefer Bun-native APIs and file/database access where possible.
- Treat SQLite as the local source of truth for delegation state, not as a cache.
- Keep the CLI fast enough for repetitive agent orchestration loops.
