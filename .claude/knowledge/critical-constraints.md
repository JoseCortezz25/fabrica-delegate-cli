# Critical constraints

These are the non-negotiables for the delegation control plane:

- Do not collapse the control plane into a single launcher or monolith.
- Keep the delegation registry, workspace manager, and provider adapters as separate seams.
- Persist lifecycle state and events in SQLite; do not rely on ephemeral process memory for truth.
- Isolate agent work in a dedicated workspace or worktree.
- Preserve headless execution as a first-class mode; the TUI is optional, not the core contract.
- Keep provider adapters thin and replaceable.
- Do not introduce browser/app architecture rules that do not apply to a CLI.
- No React component tree as the primary UI model.
- No RSC, server actions, or server-centric rendering assumptions.
- Do not add networked orchestration dependencies when a local process, workspace, or SQLite record is sufficient.
- Favor explicit state transitions and event records over hidden side effects.
