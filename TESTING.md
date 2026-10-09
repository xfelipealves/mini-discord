# Testing and verification

## Checks without external services

```sh
npm ci
npm test
npm run build
npm audit --omit=dev
npm audit
```

`npm test` runs `test:unit` (Jest/ts-jest, 48 tests) and `test:frontend` (Node test runner, 7 tests). The backend suites use temporary adapters; they never connect to a running dev server or to Scylla. They cover validation, malformed JSON, HTTP limits, channels, before/after pagination, concurrent retries, persistence across reopen, single seeding, corruption, locking and SSE. The frontend helper tests cover chronological merging, TimeUUID rollover, per-channel filtering, search and retries after editing text or changing the profile.

`npm run test:watch` only watches Jest. `scripts/run-tests.sh` runs the standard checks; `--scylla` selects the external tests. `tests/frontend/frontend-tests.html` is a pure helper harness for the browser, not an end-to-end suite and not proof against a real database.

## External API / Scylla

```sh
# On a separate lab server, with Scylla and the schema ready:
STORAGE_MODE=scylla API_PORT=4320 npm run dev
# In another terminal:
API_TEST_URL=http://localhost:4320 npm run test:scylla
```

The suite requires `/health.storage=scylla`, creates channels with unique names and writes test data. Do not run it against a demo with data you care about. It does not delete those channels, so reserve a lab keyspace. `npm run test:integration` and `scripts/test-scylla-concepts.sh` point at the same contract and small-load suite. It checks observable retry/LWT behavior, isolation, pagination and accepted consistency levels, but it does not establish cluster or performance guarantees.

To verify **only the HTTP contract** against local JSON storage, opt in to that mode explicitly:

```sh
API_TEST_ALLOW_LOCAL=1 API_TEST_URL=http://localhost:4320 npm run test:integration
```

That result is not a ScyllaDB test. For this delivery, the external tests ran against an isolated local process; no Scylla instance was started.

## Manual QA

Use two tabs on the same origin. Create a channel in the first one, confirm it appears in the second without a reload, select it and send a message; check that each tab shows exactly one copy. Send literal HTML and confirm it stays text. Change the display name, reload, and check the profile and the per-channel draft. Simulate a lost response after a successful write; retry the send and confirm the same message and ID come back.

With more than 50 messages, reload, select the channel and load older pages. Check the order, the absence of overlap and that the button hides once history is exhausted. Disconnect SSE, write more than one page of messages and reconnect: history must recover the gap. Delay one channel's response and switch channels: stale data must not replace the current selection.

At 390×844, check overflow, the composer, the drawer, focus on open/close, Tab/Shift+Tab and dialogs with Escape/Cancel. Search must state how many messages are loaded; the participant list must not claim presence. Viewport tests do not replace a physical phone, assistive technology or a remote deployment test.

## Evidence for this delivery

See [integration-qa.md](docs/reports/integration-qa.md), the logs in `docs/reports/` and the real captures in `docs/screenshots/`. Results in older handoff reports, such as `tests/frontend/IMPLEMENTATION-REPORT.md`, are historical; the integration logs are the final checkpoint. The full `npm audit` may exit with status 1 because of 20 moderate development-only findings; the runtime audit is at zero. CI requires tests, build and the runtime audit, and does not claim the full audit is clean.
