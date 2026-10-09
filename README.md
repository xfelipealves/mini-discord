# Mini Discord

A portfolio chat app by Felipe Alves: channels, persistent conversations and realtime updates, built with TypeScript and a responsive interface written in Brazilian Portuguese. It runs immediately with local storage; the ScyllaDB mode preserves the project's original educational goal.

![Real Mini Discord interface](docs/screenshots/desktop.png)

## Getting started

Requires Node.js 20+ and npm. After cloning and installing with `npm ci`, a single command starts both the interface and the API:

```sh
npm run dev
```

Open **http://localhost:3000**. No database, separate frontend server or `.env` file is needed. The first run creates `data/chat.json` with four channels and seven messages marked as demo content. New messages are real and shared by everyone who uses that server.

If the port is busy, pick another one instead of stopping existing services:

```sh
API_PORT=4318 npm run dev
```

## What works

- Create and switch channels, send with Enter and insert line breaks with Shift + Enter.
- History in pages of 50 messages, displayed from oldest to newest.
- SSE events for channels and messages, automatic reconnection and recovery of missed messages, including gaps larger than one page.
- Retrying an unconfirmed send with the same identity, which prevents duplicates.
- Display name and per-channel drafts saved in the browser.
- Search by text or author **only within loaded messages**; loading older pages widens the scope.
- Mobile drawer, native dialogs, error/retry states, visible focus and user content rendered as plain text.

Authors listed in the context panel are profiles found in the history; they do not indicate online presence. The display name is free text and is not authentication. There is no voice, attachments or login.

<details>
<summary>Real mobile capture (390 × 844)</summary>

![Mobile interface](docs/screenshots/mobile.png)

</details>

## Architecture

```text
Browser: HTML + CSS + JavaScript modules
  ├─ same-origin fetch → Express → validation → Storage
  └─ EventSource /api/events ← events after persistence
                                               ├─ LocalStorage: JSON on disk
                                               └─ ScyllaStorage: prepared CQL + LWT
```

`src/index.ts` serves the `public/` assets and the API from the same process. `src/validators.ts` validates payloads, limits, cursors and consistency levels. `src/storage.ts` serializes local changes, writes a temporary file with fsync and an atomic rename, and prevents two live writers on the same file. `src/scylla-storage.ts` implements the same contract with the Cassandra driver. `public/chat-core.js` centralizes merging, TimeUUID ordering, search and retry identity; `public/app.js` coordinates the interface flows. `src/db.ts` keeps the historical educational CQL helpers; the current API uses the Storage adapters.

## Configuration and persistence

The app loads `.env` automatically when present; `.env.example` lists the options. Variables exported by the process take precedence.

| Variable                    | Default            | Purpose                                        |
| --------------------------- | ------------------ | ---------------------------------------------- |
| `API_PORT`                  | `3000`             | HTTP port for the interface/API                |
| `STORAGE_MODE`              | `local`            | `local` or an explicit `scylla`                |
| `LOCAL_DATA_FILE`           | `./data/chat.json` | Path of the local JSON store                   |
| `REQUEST_BODY_LIMIT`        | `32kb`             | HTTP body size limit                           |
| `SCYLLA_CONTACT_POINTS`     | `127.0.0.1`        | Comma-separated hosts                          |
| `SCYLLA_DATACENTER`         | `datacenter1`      | Driver datacenter                              |
| `SCYLLA_KEYSPACE`           | `chat`             | Pre-initialized keyspace                       |
| `DEFAULT_WRITE_CONSISTENCY` | `ONE`              | Default write consistency                      |
| `DEFAULT_READ_CONSISTENCY`  | `ONE`              | Default read consistency                       |
| `CORS_ORIGIN`               | unset              | Optional extra origin; not needed for the demo |

The JSON store and retry records survive reloads and server restarts; the display name and drafts live in that browser's localStorage for that origin. A new origin or port gets its own profile. Do not remove `.lock`/`.recovery` files while writers are running: an uncertain recovery fails safely and requires inspection. Invalid JSON makes startup fail instead of silently discarding data.

To serve the build:

```sh
npm ci
npm run build
npm start
```

Run it from the project root and ship `dist/`, `public/`, `package.json`, the lockfile and runtime dependencies. For a hosted demo, point `LOCAL_DATA_FILE` at a persistent volume, run **a single instance**, and put TLS/a reverse proxy in front. The proxy must allow long-lived SSE, disable buffering on `/api/events` and allow reconnections. Stopping with SIGINT/SIGTERM releases the lock. No Dockerfile is provided; the existing Compose files only provide the Scylla lab.

## ScyllaDB lab

Local mode does not simulate replication, quorum or LWT. To exercise real CQL, start the service with Docker Compose:

```sh
docker compose up -d
# Wait until scylla is healthy and scylla-init exits without errors.
docker compose logs scylla-init
STORAGE_MODE=scylla npm run dev
```

The `docker/init-schema.cql` schema creates the `chat` keyspace and the `messages` table. The adapter adds `channels` and `message_retries` and registers the default channels without seeding demo messages. Local data is not migrated automatically. In `docker-compose.cluster.yml`, the schemas use NetworkTopologyStrategy/RF=3 to explore replication; check the datacenters and contact points before connecting. These images and settings are a historical lab, not a production operations recommendation.

Concepts preserved:

- **Partition key:** `PRIMARY KEY ((channel_id), message_id)` groups a channel's history.
- **Clustering:** `message_id timeuuid` with DESC order makes recent messages and cursor pages cheap to read. The UI reverses the presentation; TimeUUID timestamp fields break ties within the same millisecond.
- **LWT:** `INSERT ... IF NOT EXISTS` on `message_retries` picks and stores the full payload for `(channel_id, client_msg_id)`. A retry can complete an interrupted write on the same primary key.
- **Consistency:** ONE, TWO, THREE, QUORUM, ALL, LOCAL_ONE, LOCAL_QUORUM and ANY (writes only). Invalid explicit levels return 400; an invalid default configuration prevents startup. The LWT retry uses LOCAL_QUORUM/LOCAL_SERIAL regardless of the message insert consistency.
- **RF and datacenter:** SimpleStrategy/RF=1 in the simple lab; NetworkTopologyStrategy/RF=3 in the cluster examples. Quorum is not a performance promise, and a JSON-backed test does not prove distributed behavior.

`message_dedupe` in the older schemas belongs to the educational helpers; the API uses `message_retries` with a recoverable payload. No test against a live ScyllaDB was run for this delivery.

## Basic API

Every JSON response includes `ok`; errors carry `error: { code, message }` and an appropriate HTTP status.

| Method and route                 | Contract                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Storage mode, datacenter and keyspace; does not authenticate users                                                      |
| `GET /api/channels`              | `{ ok, items }`                                                                                                         |
| `POST /api/channels`             | `{ name, description? }` → 201 `{ ok, channel }`; duplicate slug → 409                                                  |
| `POST /api/messages`             | `{ channel_id, user_id, content, client_msg_id?, consistency? }` → `{ ok, message_id, message, deduped }`               |
| `GET /api/channels/:id/messages` | `limit=1..100` (default 50), `before` **or** `after` TimeUUID v1, `consistency?`; `{ items, page: { next_before } }` |
| `GET /api/events`                | Named SSE events: `connected`, `channel`, `message`; heartbeat comments                                                 |

API history is DESC and `next_before` is null once exhausted. Create the channel before sending; an unknown channel returns 404. Channel name: 1–60 characters with a valid ASCII slug; description: up to 240. Message: 1–2000 non-blank characters; author and retry ID: up to 100. The form allows up to 50 characters for the display name. Repeating the same key in the same channel returns the original message; changing the author or content under the same key returns 409. Without a retry key, every POST creates a new message.

```sh
curl http://localhost:3000/api/channels
curl -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"channel_id":"general","user_id":"Visitor","content":"Hello!","client_msg_id":"example-1"}'
```

## Validation

```sh
npm test
npm run build
npm audit --omit=dev
```

`npm test` runs the backend tests and the frontend helper tests without any external database. [TESTING.md](TESTING.md) covers optional checks and manual QA; the [integration report](docs/reports/integration-qa.md) records the evidence for this delivery. GitHub Actions runs tests, build and the runtime audit on Node 20 and 22.

## Current limits

This public demo accepts free-form names and messages from any visitor. There is no authentication, authorization, moderation, rate limiting, message editing/deletion or account recovery. Do not share private information.

The JSON store rewrites the whole data set, keeps history and retries indefinitely and serves one small process. SSE is local to the process: there is no broker between instances, no replay buffer and no delivery guarantee; the browser reconciles through history. A Scylla retry that completes an interrupted insert can return `deduped: true` without a new SSE event; clients must reconcile history. When reconnecting without any known message, recovery may load every available page. Search stays limited to loaded messages, with no global index.

Mobile captures use an emulated viewport and do not prove behavior with a physical phone keyboard or a screen reader. A live Scylla cluster, remote deployment and distributed fault tolerance were not tested. The runtime audit reports no known vulnerabilities; the full audit (including development dependencies) still reports 20 moderate findings in the Jest/ts-jest chain via sprintf-js, so the full audit is not zero. No license is declared in this repository.
