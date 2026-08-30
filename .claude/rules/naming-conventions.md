# Naming conventions

Use predictable, CLI-friendly naming across the project.

## Rules

- File and directory names use `kebab-case`.
- Types, interfaces, classes, and enums use `PascalCase`.
- Variables, functions, and methods use `camelCase`.
- Constants use `UPPER_SNAKE_CASE` when they are true constants.
- Command names should stay short, descriptive, and stable.
- Keep provider names and adapter identifiers consistent across files, tests, and documentation.

## Examples

- `workspace-manager.ts`
- `ProviderAdapter`
- `registryPath`
- `MAX_RETRY_COUNT`

Avoid naming that looks like a UI application; this repository is a Bun/TypeScript CLI.