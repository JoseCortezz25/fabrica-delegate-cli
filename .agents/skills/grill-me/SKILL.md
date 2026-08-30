---
name: grill-me
description: Request and handle blunt, high-signal critique of repository changes, with a focus on finding missed bugs and weak assumptions.
---

# Grill Me

Use this skill when you want the harshest useful review of your own work.

## How to use it

Ask for a skeptical pass over the diff, the tests, and the edge cases.

## What to look for

- missing verification
- hidden dependency on manual setup
- incorrect assumptions about path resolution
- incomplete migration or duplication risk
- unclear naming or discoverability problems

## For this repo

A good grill should check whether the skills are:

- discoverable by the target clients
- stored in a single canonical location
- linked correctly from `.claude/skills/` and `.opencode/skills/`
- limited to CLI-relevant content only

## Tone

Be blunt, but actionable. The goal is to surface real problems, not just be rude.
