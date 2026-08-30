---
name: code-audit
description: Audit the fabrica-delegate control plane for safety, command execution risk, filesystem boundaries, and brittle assumptions.
---

# Code Audit

Audit the fabrica-delegate control plane.

Focus on:
- unsafe shell or command execution
- filesystem and worktree isolation
- state persistence and recovery
- environment and path handling
- malformed input and error handling

Prefer findings that are specific, reproducible, and tied to the Bun/TypeScript implementation.
Do not suggest UI/React changes.
