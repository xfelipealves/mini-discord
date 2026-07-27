# Mini Discord

Mini Discord is a small educational chat application for exploring ScyllaDB data-modeling and consistency concepts. It is not a production-ready Discord replacement or a general-purpose chat service.

The repository contains:

- A TypeScript/Express API backed by ScyllaDB through `cassandra-driver`.
- A static HTML frontend that sends messages and loads channel history.
- Docker Compose definitions for a single-node development database and a three-node local cluster.
- Unit, API-backed integration, frontend, and shell-based concept tests.

## What It Demonstrates

- Channel-based partitioning with `channel_id` as the partition key.
- TimeUUID clustering and newest-first message ordering.
- `before` and `after` cursor queries for message history.
- Configurable read and write consistency levels.
- Lightweight transactions (LWT) with `client_msg_id` for duplicate prevention.
- The difference between a local RF=1 schema and a three-node RF=3 schema.

These examples are intentionally small so the ScyllaDB behavior is visible in the schema, API, and test scripts.

## Architecture

```text
Browser
  public/index.html
  - Static HTML, CSS, and JavaScript
  - Sends messages and loads channel history
  - Calls http://localhost:3000
           |
           | HTTP/JSON with CORS
           v
Express API
  src/index.ts
  - Input validation and structured error responses
  - Consistency selection
  - Message and health endpoints
           |
           | CQL on port 9042
           v
ScyllaDB
  - chat.messages
  - chat.message_dedupe
  - RF=1 with SimpleStrategy in development mode
  - RF=3 with NetworkTopologyStrategy in cluster mode
```

The API does not serve the frontend. Run a separate static web server for `public/`. The browser client currently has the API URL hard-coded as `http://localhost:3000`.

## Project Tree

```text
.
├── src/
│   ├── db.ts                         ScyllaDB connection and queries
│   ├── index.ts                      Express app and API routes
│   ├── types.ts                      API TypeScript types
│   └── validators.ts                 Request and consistency validation
├── public/index.html                 Static browser client
├── docker/
│   ├── init-schema.cql               Development schema, RF=1
│   ├── init-schema-cluster.cql       Cluster schema, RF=3
│   └── init-schema-test.cql           Test keyspace schema, RF=1
├── docker-compose.yml                Single-node ScyllaDB setup
├── docker-compose.cluster.yml        Three-node ScyllaDB setup
├── scripts/
│   ├── run-tests.sh                  Unit/integration test runner
│   ├── setup-test-db.sh              Creates the test schema
│   └── test-scylla-concepts.sh       LWT, consistency, pagination, and other checks
├── tests/                             Jest and browser tests
├── .env.example                      Example runtime configuration
├── jest.config.js                    Jest configuration
├── package.json                      Commands and dependencies
└── TESTING.md                        Additional testing notes
```

## Prerequisites

- Docker with Docker Compose support.
- Node.js 20 or newer.
- npm.
- Python 3 if you want to serve the static frontend with the example command.
- A modern browser.

The Compose files use ScyllaDB `5.2` images and allocate a deliberately small local development footprint. Adjust Docker resources if the containers cannot start on your machine.

## Quick Start: Development Mode

Development mode runs one ScyllaDB node with RF=1.

### 1. Clone and install

```bash
git clone https://github.com/xfelipealves/mini-discord.git
cd mini-discord
cp .env.example .env
npm install
```

### 2. Start ScyllaDB

```bash
docker compose up -d
docker compose logs scylla-init
```

Wait for `Schema initialized successfully` before starting the API. If your installation uses the legacy command, `docker-compose` can be used in place of `docker compose`.

### 3. Load configuration and start the API

The application reads environment variables from `process.env`. It does not call `dotenv.config()` at startup, so load `.env` into the shell explicitly:

```bash
set -a
. ./.env
set +a
npm run dev
```

The API listens on `http://localhost:3000` by default.

### 4. Serve the frontend

In a second terminal:

```bash
python3 -m http.server 8080 --directory public
```

Open <http://localhost:8080>, choose a channel and user, send a message, and use **Load Latest** or **Load Older** to inspect the results.

To stop the development database:

```bash
docker compose down
```

## Cluster Mode

Cluster mode starts three local ScyllaDB nodes and initializes `chat` with RF=3 using `NetworkTopologyStrategy` for `datacenter1`.

Stop development mode first, then start the cluster:

```bash
docker compose down
docker compose -f docker-compose.cluster.yml up -d
docker compose -f docker-compose.cluster.yml logs scylla-cluster-init
```

Wait for `Cluster schema initialized successfully`. The first node is available at `127.0.0.1:9042`; the other nodes are mapped to host ports `9043` and `9044`. The default `.env.example` contact point (`127.0.0.1`) connects the API through the first node.

Load the environment and start the API as in development mode:

```bash
set -a
. ./.env
set +a
npm run dev
```

Use cluster mode when experimenting with RF=3 and consistency behavior. The Compose setup is for local learning; it is not a production cluster configuration.

To stop the cluster:

```bash
docker compose -f docker-compose.cluster.yml down
```

## API Summary

### `POST /api/messages`

Creates a message. Required fields are `channel_id`, `user_id`, and `content`.

```json
{
  "channel_id": "general",
  "user_id": "alice",
  "content": "Hello",
  "consistency": "ONE",
  "client_msg_id": "optional-dedup-key"
}
```

Validation limits are 1-100 characters for `channel_id` and `user_id`, 1-2000 characters for `content`, and 1-100 characters for `client_msg_id`.

A successful new message returns:

```json
{
  "ok": true,
  "message_id": "timeuuid"
}
```

Reusing the same `client_msg_id` within a channel returns `deduped: true` instead of inserting another message.

### `GET /api/channels/:channel_id/messages`

Returns messages for one channel, newest first.

Query parameters:

- `limit`: 1-100, default `20`.
- `before`: Return messages older than this TimeUUID.
- `after`: Return messages newer than this TimeUUID.
- `consistency`: Override the read consistency level.

`before` and `after` cannot be used together. The response includes `page.next_before` for older-page navigation.

### `GET /health`

Returns the configured datacenter and keyspace after the API has connected to ScyllaDB:

```json
{
  "ok": true,
  "dc": "datacenter1",
  "keyspace": "chat"
}
```

Invalid requests return structured errors with HTTP 400 by default. `USE_SOFT_ERRORS=true` changes handled error responses to HTTP 200, while retaining `ok: false` in the response body.

## ScyllaDB Schema

The application uses the `chat` keyspace in both runtime modes:

```sql
CREATE TABLE messages (
    channel_id text,
    message_id timeuuid,
    user_id text,
    content text,
    created_at timestamp,
    PRIMARY KEY ((channel_id), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

CREATE TABLE message_dedupe (
    channel_id text,
    client_msg_id text,
    PRIMARY KEY ((channel_id), client_msg_id)
);
```

`messages` keeps each channel in its own partition and orders rows by descending `message_id`. `message_dedupe` is written with `IF NOT EXISTS`, which is the LWT used by the API for idempotency.

## Configuration

Start from the tracked example file:

```bash
cp .env.example .env
```

Because the application does not load `.env` itself, export it before `npm run dev`:

```bash
set -a
. ./.env
set +a
```

Available variables in `.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCYLLA_CONTACT_POINTS` | `127.0.0.1` | Comma-separated ScyllaDB contact points. |
| `SCYLLA_DATACENTER` | `datacenter1` | Local datacenter name used by the driver. |
| `SCYLLA_KEYSPACE` | `chat` | Keyspace used by the API. |
| `API_PORT` | `3000` | HTTP port for the API. |
| `DEFAULT_WRITE_CONSISTENCY` | `ONE` | Default write consistency. |
| `DEFAULT_READ_CONSISTENCY` | `ONE` | Default read consistency. |
| `REQUEST_BODY_LIMIT` | `1mb` | Express JSON body limit. |
| `CORS_ORIGIN` | `*` | Allowed CORS origin; permissive by default for local development. |
| `USE_SOFT_ERRORS` | `false` | Return HTTP 200 for handled errors when set to `true`. |

Supported consistency names are `ANY`, `ONE`, `TWO`, `THREE`, `QUORUM`, `ALL`, `LOCAL_ONE`, and `LOCAL_QUORUM`.

## Tests

Install dependencies before running tests:

```bash
npm install
```

Unit tests do not require a running API:

```bash
npm test -- tests/unit/
```

Integration tests call `http://localhost:3000` and require ScyllaDB, the schema, and the API to be running:

```bash
docker compose up -d
set -a; . ./.env; set +a
npm run dev
```

In another terminal:

```bash
npm test -- tests/integration/
```

The integration tests write sample data to the API's configured keyspace. Use a disposable local database when running them.

The repository also provides:

```bash
# Run all Jest tests; integration tests need the API running.
npm test

# Run the helper, which falls back to unit tests if the API is unavailable.
./scripts/run-tests.sh

# Run all ScyllaDB concept checks.
./scripts/test-scylla-concepts.sh

# Run one concept check.
./scripts/test-scylla-concepts.sh lwt
```

Available concept arguments are `all`, `lwt`, `consistency`, `pagination`, `partitioning`, and `performance`. For the manual frontend checks, open `tests/frontend/frontend-tests.html` in a browser.

## Limitations and Security

- There is no authentication or authorization. Anyone who can reach the API can read and write messages.
- The default CORS policy is `*`; restrict `CORS_ORIGIN` before exposing the API beyond local development.
- The frontend is a static local client and hard-codes `http://localhost:3000`.
- There are no WebSockets, subscriptions, or push notifications; refreshes are request-based.
- There are no metrics or tracing, and logging is basic request/error output.
- The API runs as one process and has no production deployment, load balancing, or operational configuration.
- The deduplication table has no retention or cleanup policy.
- The Docker cluster files are educational local fixtures, not a hardened ScyllaDB deployment. Do not expose them to untrusted networks.

Do not use this project in production without adding authentication, authorization, input and abuse controls, secure CORS and network policies, TLS, secrets management, monitoring, backups, data-retention policies, and a deployment design appropriate for the workload.

## Contribution and License Status

There is no `CONTRIBUTING.md` in the repository, so there is no repository-specific contribution process to follow.

There is no `LICENSE` file. The project should not be assumed to be MIT-licensed; confirm licensing with the repository owner before redistributing or using it outside personal learning.

## Educational Scope

This repository is intended for learning and local experimentation with ScyllaDB concepts. The examples show how a small API maps channel history, TimeUUID ordering, LWT deduplication, and consistency settings onto CQL. They do not establish production performance, availability, security, or fault-tolerance guarantees.
