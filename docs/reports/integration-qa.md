# Integration delivery — Mini Discord portfolio revival

Date: 2026-10-08. Task `task_2fa52383558d`, Dispatch `ctx_403570b07b9c`. Integrated both workers’ uncommitted backend/frontend work after reading their reports, source and diffs; no push, publication or remote merge.

## Result and review location

- Working app: **http://localhost:4318** with durable `./data/chat.json`.
- Orca DEV terminal: `term_aa89f642-c23e-463d-9242-dbf7ee801c9c`, title **Mini Discord DEV 4318**; terminal show confirms running tsx and startup, final same-origin health reports local/ok.
- Primary browser page: `7e48ba7c-e1e0-47c5-b1f5-a730db68c2f7`, left at 4318/Geral, desktop 1361×948.
- Realtime peer: `585218a8-f664-4ca5-814b-00b007051d4c`, same workspace/origin.
- Isolated compiled QA instance on 4320 was started, stopped, restarted with the same temporary JSON, verified, then stopped; DEV 4318 remained intact. No unrelated service was stopped.

## Integration changes

1. Fixed the frontend TimeUUID tie-break after a failing rollover regression: timestamp fields now order messages sharing a millisecond, matching backend chronology.
2. Added frontend helper checks to `npm test`; upgraded Jest/types/ts-jest to compatible current releases and updated the Jest 30 external-suite flag.
3. Matched channel form max lengths to the API (60/240), formatted frontend assets/harness/helpers for review.
4. Replaced stale external tests with current contracts, unique channels, explicit Scylla health guard and optional local-contract-only mode; replaced misleading legacy curl script with the current suite entry point.
5. Rewrote README/TESTING around one-command development, real behavior, API, persistence/deployment and Scylla concepts/limits. Added actual clean-seed desktop/mobile screenshots, Node 20/22 CI, durable logs; removed two unrelated Git-account test placeholders containing personal details.
6. Preserved the Scylla adapter, historical CQL helpers and Compose schemas. No Dockerfile was added or claimed tested.

All backend/frontend changes in the worktree were intentionally included in the local delivery commit, including handoff reports and tests. Source groups: `src/**`, `public/**`, `tests/**`, package/lockfile, env/ignore, scripts, documentation and `.github/workflows/ci.yml`.

## Fresh automated evidence

| Check | Observed result | Log |
| --- | --- | --- |
| `npm test` | 48 backend + 7 frontend passed, zero failures | [tests.log](tests.log) |
| `npm run build` | tsc exit 0 | [build.log](build.log) |
| `npm audit --omit=dev` | 0 vulnerabilities, exit 0 | [audit-runtime.log](audit-runtime.log) |
| `npm audit` | 20 moderate development findings, exit 1 | [audit-full.log](audit-full.log) |
| Explicit local external HTTP contract | 2 suites / 4 tests passed | [external-local-contract.log](external-local-contract.log) |
| `git diff --check` | exit 0 | final terminal check |

The upgrade reduced the original audit from 34 findings (29 high, 5 moderate) to 20 moderate findings, all through the development Jest/ts-jest chain via sprintf-js/argparse/js-yaml. No forced downgrade/rewrite was used. GitHub-hosted CI and its Node matrix have not run here; the local logs are from the available host Node runtime.

## Orca manual evidence

All interactions used this worktree’s embedded browser, exact page IDs, typed navigation/fill/snapshot/screenshot commands and supported `orca eval`.

- Same-origin `/health`, `/api/channels`, POST/history and SSE work on 4318. Channel created through the dialog became selected, showed empty history, and appeared in the peer tab without reload.
- Profile set through the dialog and survived reload. Composer Enter handler submitted; POST plus SSE merged into one rendered copy in both tabs.
- Literal HTML containing image onerror and script rendered visibly as text; zero message img/script nodes, XSS probe flag remained false.
- Search returned one matching result and declared the loaded-count scope.
- Injected a **lost response after an actual successful write**: first attempt preserved draft and non-confirmation feedback; second used identical client_msg_id; final DOM had one copy and an empty composer. Restored original fetch.
- Created 65 pagination records. After reload/switch: exactly 50 loaded (records 016–065); older-page action produced 67 unique total messages, page records 001–065 in chronological order, exhausted button hidden.
- Closed a captured EventSource with 67 messages known, stored 65 more in the peer, then used reconnect: 132 unique messages, all 65 missed records recovered, live status restored. Restored the page by navigation afterwards.
- Delayed Projetos history by 500ms while selecting Design: final title/content remained Design with one correct seeded message.
- 390×844 viewport: no horizontal document overflow, readable content/composer; drawer focused close button, made main inert, wrapped synthetic Tab from final control to first and restored menu focus on synthetic Escape. Profile dialog opened with named input focus and close control returned to drawer flow.
- Fresh **compiled** node process on 4320: UI sent a message; stopped this QA process, reopened the same JSON in a new compiled process, reloaded Orca tab and confirmed the exact message ID/content both through history and rendered DOM. No live Scylla involved.
- Final console check on restored 4318 returned no messages; final health/live status and terminal ownership verified.

Orca pointer click and keypress commands occasionally returned success without dispatching the expected event under viewport emulation; one wait lost its runtime connection. DOM activation and synthetic keyboard events through Orca eval verified handlers, but do not establish native physical-keyboard or pointer behavior on all devices. Snapshots and screenshots verified actual page output. No unrelated/external browser or Playwright was used.

## Screenshots

[Desktop](../screenshots/desktop.png) and [mobile](../screenshots/mobile.png) were captured from the actual compiled app on a clean seeded temporary local store at 4320, before test records were added. Both were visually inspected; they show the real current assets and default Visitante profile. QA data on 4318 was preserved. The README screenshot is not a mockup.

## Material limits

- ScyllaDB and RF=3 cluster were **not run**; external tests used explicit local opt-in and cannot prove LWT/distributed consistency. Compose deployment, remote hosting, physical mobile keyboard, native keyboard automation, reduced-motion OS preference and assistive technology were not fully tested.
- Public demo is intentionally unauthenticated, without moderation/rate limiting or message editing/deletion. Names are free display labels, participant lists are loaded authors, and search covers loaded history only.
- Local JSON is for a small single-process demo: entire-file writes, unbounded retention/retries, exclusive writer lock. No multi-process scaling.
- SSE is process-local with no broker/replay buffer; history reconciles reconnect gaps. No-known-message recovery can fetch all available pages; Scylla retry completion can require history reconciliation without a fresh SSE event.
- Full audit remains nonzero for development dependencies; runtime audit is clean at this checkpoint.

The working DEV and both Orca tabs remain available to the coordinator. The local commit hash is returned in the completion message; nothing was pushed.
