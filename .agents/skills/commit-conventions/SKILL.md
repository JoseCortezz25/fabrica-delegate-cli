---
name: commit-conventions
description: Conventional commit guidance for this repository, including branch hygiene, commit message format, and PR traceability.
---

# Commit Conventions

Use this skill when creating commits, squashing work, or naming PRs.

## Commit format

Prefer conventional commits:

```text
<type>(<scope>): <subject>
```

Examples:

- `feat(skills): add canonical project skills`
- `docs(readme): clarify workspace behavior`
- `test(cli): cover skill discovery wiring`

## Scope guidance

Choose the smallest useful scope:

- `skills` for skill-library changes
- `cli` for command behavior
- `workspace` for worktree/workspace behavior
- `docs` for README or skill docs

## Subject guidance

- Use imperative mood.
- Keep it concise and specific.
- Avoid filler like “update” unless it is genuinely the best description.

## PR hygiene

- Keep unrelated changes out of the same commit.
- If a task spans multiple files, describe the user-visible outcome in the commit subject.
- Match the PR title to the task when possible so it is easy to trace back.

## For this repo

Before committing, make sure the worktree is clean except for the intended changes, then run the real checks that prove the change.
