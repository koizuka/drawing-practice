---
name: merged
description: Clean up the local repository after a PR branch has been merged. Use when the user says merged, "マージした", "後始末して", "clean up", or otherwise asks Codex to switch back to main, pull the latest main, delete the merged local branch, and prune stale remote-tracking branches.
---

# Merged Cleanup

## Overview

Return the repository to an up-to-date `main` checkout after a PR merge and remove the merged local branch.

## Workflow

Perform these steps immediately without asking for confirmation unless the worktree has uncommitted changes that would be affected by switching branches.

1. Determine the branch to clean up:
   - If the user supplied a branch name, use it.
   - Otherwise use `git branch --show-current`.
   - Save that branch name before switching.

2. Check the worktree:
   - Run `git status`.
   - If there are uncommitted changes, stop and report that cleanup cannot safely continue until they are committed, stashed, or discarded by the user.

3. Update `main`:
   - Switch to `main`.
   - Pull the latest changes from `origin/main`.

4. Remove stale branch state:
   - Delete the merged local branch with `git branch -D <branch>`.
   - Do not attempt to delete `main`.
   - Run `git remote prune origin`.

5. Summarize the cleanup:
   - Report the branch removed.
   - Report the current branch.
   - Report the pulled main status or latest commit.

## Failure Handling

If any git command fails, stop and summarize the failing command and relevant output. Do not retry destructive branch deletion with a different target unless the user explicitly asks.
