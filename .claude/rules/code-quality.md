# Code quality

Keep the codebase aligned with the repo's strict TypeScript and Biome setup.

## Requirements

- Write strict TypeScript only.
- Do not use `any`; prefer `unknown`, generics, or explicit domain types.
- Do not leave unused imports, variables, parameters, or exports.
- Keep functions small and purpose-built.
- Prefer explicit return types on exported functions.
- Keep Biome lint and formatting warnings at zero.
- If a type needs to be narrowed, narrow it explicitly instead of suppressing the error.

## Practical checks

- `bun x tsc --noEmit`
- `bun x biome check src test`

If a change would require loosening TypeScript or lint rules, treat that as a design issue rather than the default path.