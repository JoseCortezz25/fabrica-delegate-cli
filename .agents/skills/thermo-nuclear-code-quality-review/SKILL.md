---
name: thermo-nuclear-code-quality-review
description: Extremely strict code review checklist for this CLI repo: correctness, maintainability, test coverage, and regression risk.
---

# Thermo-Nuclear Code Quality Review

Use this skill when reviewing your own changes before declaring them done.

## Review goals

Be adversarial. Assume there is a bug until the evidence says otherwise.

## Checklist

- Does the change satisfy the issue exactly?
- Are there any accidental side effects outside the requested scope?
- Are file paths, symlinks, and discovery rules correct on disk?
- Do tests or verification commands prove the result, not just the build?
- Is the implementation consistent with existing project patterns?
- Could the change break CI, packaging, or cross-platform behavior?

## For this repo

Pay special attention to:

- `bun run typecheck`
- `bun run lint`
- `bun test`
- git worktree / symlink behavior
- whether hidden directories like `.claude/` and `.opencode/` resolve correctly

## Output style

When giving review feedback, be direct and prioritized:

1. blocking issues
2. important risks
3. minor polish

If there are no blockers, say so plainly and mention the evidence that supports that conclusion.
