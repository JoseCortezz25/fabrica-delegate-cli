# AGENTS.md

## Workflow protocol

- Implement the requested task in the CLI.
- Before marking work complete, validate it as a normal end user would by running the real CLI flows end-to-end: `create` → `start` → `watch` → `result`.
- Confirm the observable behavior matches expectations; do not rely only on unit tests, mocks, or code inspection.
- Do not mark work complete until that end-user validation has passed.
