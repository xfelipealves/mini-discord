# Frontend handoff — Mini Discord

> **Historical record.** This is the frontend worker handoff written before integration. Counts and temporary paths reflect that moment; for example, the helper suite later grew from six to seven tests. See [TESTING.md](../../TESTING.md) and [the integration report](../../docs/reports/integration-qa.md) for current verification.

Scope: only `public/**` and `tests/frontend/**`; no staging, commits or publishing.

## Exact files

- `public/index.html`: Portuguese semantic shell, server rail, channel sidebar/drawer, conversation, context panel and native dialogs.
- `public/styles.css`: documented slate/periwinkle tokens, local Avenir Next/Avenir/Segoe UI type stack, responsive layout, focus states, reduced motion and safe-area treatment.
- `public/app.js`: same-origin API, channel lifecycle, history, composer, draft persistence, profile, search and EventSource recovery.
- `public/chat-core.js`: pure chronological/deduplicating merge, retry identity and search helpers.
- `tests/frontend/chat-core.test.mjs`: six deterministic Node tests.
- `tests/frontend/frontend-tests.html`: replaced obsolete hardcoded cross-origin/backend-mutating harness with pure browser helper checks (not run in this dispatch).
- `tests/frontend/IMPLEMENTATION-REPORT.md`: this handoff.

## Design plan and critique

Tokens: rail #171e29, sidebar #202938, conversation #252f40, field #303c50, text #edf2fa, restrained periwinkle #a5b4fc, structural border #38465b. Typography uses local fonts and no network/build dependency. Desktop is rail | channels | chronological conversation | context; mobile is the conversation plus an explicit drawer. The monogram and generous message rhythm carry identity, while no cards, fictitious presence, voice/attachment controls or online counts are used. Screenshot critique reduced title weight and corrected mobile menu alignment. Mobile search and dialogs have explicit accessible names; drawer isolates background focus and traps Tab, native dialogs handle modal focus.

## Implemented flows

- Automatic channel/history loading, create/switch channels and useful load/empty/error/retry states.
- Cursor `before` pagination merged oldest-to-newest; stale channel generations cannot update active history.
- Enter sends, Shift+Enter newline, composition-aware key handling; request disables send and composer.
- Local per-channel drafts, saved profile name, persistent pending payload and client_msg_id across failed retry; editing text generates a new identity. Renaming profile does not change an existing ambiguous retry payload.
- Full message text rendered only via textContent, with newline preservation and overflow wrapping.
- Loaded-message search by author/content with explicit loaded-count scope; context participants reflect loaded authors and expressly do not represent presence.
- Named message/channel EventSource listeners, connection feedback/manual retry, automatic reconnect; recovery walks latest-to-older pages until a known message is found, covering gaps larger than one page and merging without duplicates.
- About dialog checks /health and explains demo seed profiles plus shared real messages.
- VisualViewport resizing and bounded composer keep writing area usable when viewport shrinks.

## Contract

No additions required. Recovery deliberately uses the documented `before` pagination rather than guessing the encoding of an `after` cursor. POST /api/messages accepts optional message in response; without it, frontend recovers server history. Fetch requests timeout after 15 seconds, leaving pending payload intact.

## Fresh validation evidence

- `node --test tests/frontend/chat-core.test.mjs`: 6 passed, 0 failed (ordering/merge, cross-channel filtering, retry id/content/user, edited payload, search and profile rename on retry).
- `node --check public/app.js`: exit 0 after final behavioral changes and formatting.
- Only Orca embedded page `7e48ba7c-e1e0-47c5-b1f5-a730db68c2f7` in this worktree was used.
- Backend launched in an isolated test instance: API_PORT=4317 STORAGE_MODE=local LOCAL_DATA_FILE=/tmp/mini-discord-frontend-ctx-bb1870.json. Health returned local storage. Server remains running for integrator reuse; original process is a worker-owned tsx instance, not another project.
- Desktop screenshot reviewed at 1361×948; initial history displayed three seeded messages automatically and live status was active.
- Orca viewport set to 390×844; evaluated width 390, no document horizontal overflow, menu left 14px, named search and all three labelled dialogs.
- Channel creation and automatic selection verified with Frontend QA; empty-state invitation displayed.
- Profile edited to Felipe QA; after reload name and general-channel draft remained persisted.
- Enter submission observed as a stored message; composer cleared after success.
- Button submission of literal <script>alert(1)</script> plus newline displayed literal text, zero script nodes and one message after POST/SSE merge.
- Search for script produced exactly one loaded result and honest four-message scope.
- Injected temporary fetch failure in the test page: first POST preserved draft, visible retry feedback and localStorage pending client_msg_id; second POST used the same id, cleared draft and displayed exactly one copy. Original fetch restored afterwards.
- Browser console returned no messages at the checked checkpoint.
- Screenshots are local temporary files `/tmp/mini-discord-desktop.png` and `/tmp/mini-discord-mobile.png`; not publication artifacts.

## Integrator checks still recommended

Full integration QA should exercise pagination with more than 50 messages, reconnect with missed messages across multiple pages, delayed stale-channel responses, cross-tab new channel/message delivery, keyboard-only dialog/drawer navigation, actual phone keyboard and reduced-motion preference. Those paths are implemented and helper merge/retry tests pass, but they were not all manually exercised here. Orca briefly returned runtime_unavailable during a wait call, then recovered; no external browser fallback was used. CSS/JS formatting was completed for maintainability, without adding a build pipeline.
