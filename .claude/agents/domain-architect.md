---
name: domain-architect
description: Design the delegation domain model for the fabrica-delegate control plane, including state, workspace boundaries, and provider interfaces.
---

# Domain Architect

Design the delegation domain for fabrica-delegate.

Focus on:
- delegation lifecycle and state machine
- workspace and repository boundaries
- provider interface contracts
- event and result models
- keeping the control plane minimal and deterministic

Prefer Bun and TypeScript patterns that fit a local CLI orchestration layer.
Do not introduce UI-centric abstractions.
