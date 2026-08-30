# AGENTS.md — OpenCode entry point

This repository is `fabrica-delegate-cli`, a Bun/TypeScript delegation control plane.
It coordinates work through a registry, isolated workspaces, and provider adapters.
It is not a UI framework project.

Canonical OpenCode instructions live in `.opencode/AGENTS.md`.
Canonical Claude Code instructions live in `.claude/CLAUDE.md`.
Project notes live in `knowledge/`.
Quick-reference conventions live in `rules/`.

## General rules

- Use Bun for scripts, builds, tests, and type-checking.
- Keep changes focused on the control plane: CLI, registry, workspace manager, and provider adapters.
- Prefer isolated worktrees or workspaces for implementation work.
- Verify with real project checks before claiming success.
- Keep docs and handoff notes concise and operational.
- There is no guardian step in this workflow.

## 🔴 critical-constraints

- Do not edit the main checkout directly when a worktree is available.
- Do not introduce browser UI framework references into the control-plane docs.
- Do not hard-code provider behavior into the CLI core.
- Do not skip verification before reporting completion.
- Preserve the separation between registry, workspace, and provider adapters.
- Keep issue and PR state in sync with the actual implementation status.

## Domain clarification gate

Before making assumptions, clarify the domain when a request could mean any of the following:

- control-plane behavior vs provider-adapter behavior
- registry state vs workspace isolation vs CLI surface
- docs update vs implementation update
- issue state vs PR state vs code change
- local task vs GitHub task vs another tracker

If the request is ambiguous, ask one precise question and wait.

## Available agents

- OpenCode (`opencode`)
- Claude Code (`claude`)

## Available skills

- `fabrica-delegate`
- `setup-fabrica`
- `autonomous-ai-agents/agent-orchestration-control-plane`
- `autonomous-ai-agents/coding-agent-delegation`
- `autonomous-ai-agents/workflow-fabrica`
- `autonomous-ai-agents/skill-library-curation`
- `autonomous-ai-agents/hermes-agent`
- `github/github-operations`

## Workflow protocol

1. Read the issue or task and confirm the target scope.
2. Work in an isolated worktree or workspace.
3. Make the smallest complete change that solves the request.
4. Run the relevant Bun checks for the files you touched.
5. Commit and push the branch.
6. Open or update the PR with a clear summary.
7. Update the issue state and leave a concise status note.

## Documentation map

- `knowledge/` — architecture notes, issue context, and task-specific findings
- `rules/` — concise conventions, guardrails, and quick-reference cards
- `README.md` — project overview and CLI orientation
- `skills/fabrica-delegate/SKILL.md` — CLI operating skill for this repo
