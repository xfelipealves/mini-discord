# AGENTS.md

Canonical instructions for any coding agent working in this repository (Codex, Claude Code, Cursor, Gemini CLI and others). If another agent instruction file disagrees with this one, this file wins.

## Project

Mini Discord is a portfolio chat app: an Express + TypeScript API, a vanilla JavaScript frontend served from `public/`, local JSON storage by default and an optional ScyllaDB lab. See [README.md](README.md) for architecture and [TESTING.md](TESTING.md) for verification.

## Language

- All README files, documentation, reports, commit messages and agent instructions are written in English.
- The application interface and its demo seed content are intentionally in Brazilian Portuguese. Do not translate them unless the task asks for it.
- Historical machine logs in `docs/reports/*.log` are raw tool output; never rewrite them.

## Portfolio workflow

- Work directly on `main`. Do not create feature branches or worktrees unless the owner asks for one.
- Make small, coherent, atomic commits with descriptive English messages, then push normally to `origin/main` and wait for CI to pass.
- Never force push, rewrite published history or overwrite uncommitted work you did not create.
- Delete a branch only after confirming its commits are reachable from `main` (`git branch -d`, never `-D`) or preserved under a tag.
- Do not stop processes, dev servers or terminals you did not start. Pick a free port instead (`API_PORT=<port> npm run dev`).
- Keep documentation truthful: describe only behavior that exists and was verified, state known limits, and never present mockups, generated art or substitute images as real screenshots. `docs/screenshots/` holds real captures only.

## Verification before committing

```sh
npm ci
npm test              # 48 backend + 7 frontend tests, no external services
npm run build
npm audit --omit=dev  # runtime audit, expected to report 0 vulnerabilities
git diff --check
```

`npm audit` (full) currently reports 20 moderate development-only findings in the Jest/ts-jest chain; do not describe it as clean. ScyllaDB tests (`npm run test:scylla`) need a separate lab server and are not part of routine checks. When docs change, confirm that relative links point to tracked files.
