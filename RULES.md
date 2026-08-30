# RULES.md — quick reference

- Use Bun for install, build, test, lint, and typecheck.
- Use TypeScript and keep the CLI/codebase ESM-first.
- Keep the project focused on the delegation control plane, not a browser UI stack.
- Keep registry, workspace manager, provider adapters, and CLI responsibilities separate.
- Work in an isolated worktree or workspace for implementation tasks.
- Prefer small, reviewable commits and issue-linked branches.
- Verify changes with the repo's real checks before handoff.
- Use `gh` for issue and PR updates when available.
- Do not add browser UI framework references.
- If the domain is unclear, stop at the clarification gate and ask one precise question.
- Docs map: `knowledge/` for notes; `rules/` for concise conventions and cards.
