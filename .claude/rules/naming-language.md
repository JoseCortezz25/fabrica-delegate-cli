# Naming language

Use English-only identifiers and terminology in the codebase.

## Rules

- Code identifiers must be in English.
- File names, command names, types, and event names must be in English.
- Comments, docs, and error messages should be written in clear English.
- Do not mix localized names into public APIs or internal module names.
- If a provider or external system uses a non-English term, translate the local code name unless the external name must be preserved verbatim.

This keeps the CLI easy to scan, review, and maintain across contributors and providers.