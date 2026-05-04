---
name: create-pr
description: Create a pull request for this repository from the current local changes. Use when the user says create-pr, asks to make a PR, says "PRにして", "pull requestを作って", or otherwise wants Codex to check, branch, commit, push, and open a GitHub PR for the current work.
---

# Create PR

## Overview

Run the repository's pre-PR checks, optionally update project docs if the change affects them, create a `codex/` branch, commit all intended changes, push it, and open a PR against `main`.

## Workflow

Perform these steps immediately without asking for confirmation unless a command fails or the worktree contains unrelated changes that would make staging everything unsafe.

1. Inspect repository state:
   - Run `git status`.
   - Run `git diff HEAD`.
   - Run `git branch --show-current`.
   - Run `git log --oneline -10`.
   - Identify the intended change set and whether unrelated user changes are present.

2. Run prechecks on the current branch:
   - Run `npm run lint` and `npm run build`.
   - Run targeted tests when the change touches behavior already covered by tests, or when AGENTS.md or the relevant `.claude/rules/` guidance asks for targeted tests. Use `npm run test -- <path-or-pattern>` when a focused test target is clear; otherwise explain why tests were not run.
   - Run independent checks in parallel when the environment allows it.
   - If any required check fails, report the failure and stop before branching, committing, pushing, or opening a PR.

3. Check docs before committing:
   - Read `CLAUDE.md` if the change affects architecture, file structure, major components, or agent-facing workflow.
   - Read `AGENTS.md` if the change affects Codex-facing workflow, repository instructions, agent skills, or project structure.
   - Read `README.md` if the change affects user-facing features, development commands, stack, setup, or usage.
   - Update those files only when the change materially requires it.

4. Create the branch and commit:
   - Generate a concise branch name from the change, prefixed with `codex/`.
   - Prefer creating a new branch. If the generated branch already exists locally or remotely, inspect it before reusing it: compare its commits and diff against `main`, check whether it already has an open PR, and only reuse it when it clearly represents the same current change set. Otherwise generate a different branch name.
   - If creating `codex/<name>` fails with `unable to create directory for .git/refs/heads/codex/<name>` or `.git/index.lock: Operation not permitted`, treat it as a likely sandbox write-permission issue and rerun the same git command with approval/escalation. Do not infer that a plain `codex` branch exists unless `git branch --list 'codex'` or `git show-ref --verify refs/heads/codex` confirms it.
   - Stage all intended changes. Use `git add .` only after confirming it will not sweep in unrelated user work.
   - Generate a commit message that describes the purpose of the change. Mention doc updates if `CLAUDE.md`, `AGENTS.md`, or `README.md` changed.
   - Commit the staged changes.

5. Push and open the PR:
   - Push the branch to `origin`.
   - Create a PR against `main`.
   - Use a PR body with a short summary and the validation results from the prechecks.
   - Report the PR URL.

## Failure Handling

If a command fails because the sandbox cannot write Git metadata, request approval and rerun the same command with escalation before stopping. For other command failures, stop at the failing step and summarize the command, the relevant output, and what needs to be fixed. Do not continue to later GitHub steps after failed checks or failed git commands.
