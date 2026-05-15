# Security Policy

## Supported versions

Drawing Practice is a single-page web app deployed continuously from `main` to
GitHub Pages. Only the current deployment is supported:

- **Live**: https://koizuka.github.io/drawing-practice/

There are no released versions or branches to back-port fixes to — the fix lands
on `main` and ships on the next deploy.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's **private vulnerability reporting** instead:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, affected area, and reproduction steps.

If private reporting is unavailable, email the maintainer at koizuka@gmail.com.

You can expect an initial response within about a week. Once a fix is verified it
is merged to `main` and deployed automatically.

## Scope

This app runs entirely in the browser. Notable security-relevant points:

- The Pexels API key is **user-supplied** and stored only in the visitor's
  `localStorage` (`pexelsApiKey`). No key is bundled into the build.
- Drawing data is stored locally in the browser (IndexedDB) and is never sent to
  a server.

Reports about supply-chain integrity (dependencies, GitHub Actions, CI) are
in scope — see [docs/supply-chain-hardening.md](../docs/supply-chain-hardening.md).
