# Mini Discord - ScyllaDB Chat Application

A complete mini-chat web application to validate ScyllaDB concepts including:
- ✅ Configurable consistency levels per operation (ONE, QUORUM, ALL)
- ✅ LWT (Lightweight Transactions) for message idempotency via `client_msg_id`
- ✅ TimeUUID-based pagination (before/after cursors)
- ✅ Channel partitioning with temporal ordering
- ✅ Docker Compose setup for dev (RF=1) and cluster (RF=3) modes

## Architecture

```
┌──────────────────────────┐
│        Front Web         │
│  HTML + JS (fetch API)   │
│  - Envio de mensagens    │
│  - Lista com paginação   │
│  - Seletor consistência  │
│  - Campo client_msg_id   │
└─────────────┬────────────┘
              │ HTTP (REST, CORS)
              v
┌──────────────────────────┐
│   API Backend (Node/TS)  │
│  Express + cassandra-driver
│  Endpoints:              │
│   POST /api/messages     │
│   GET  /api/channels/:id/messages
│   GET  /health           │
│  Conceitos:              │
│   - Consistency por op   │
│   - LWT idempotência     │
│   - Paginação timeuuid   │
└─────────────┬────────────┘
              │ CQL (9042)
              v
┌──────────────────────────┐
│       ScyllaDB (OSS)     │
│ Keyspace: chat           │
│ Tables:                  │
│  - messages(...)         │
│  - message_dedupe(...)   │
│ Replication: RF=1 (dev)  │
│ Variante: cluster RF=3   │
└──────────────────────────┘
```

## Prerequisites

- **Docker & Docker Compose** (for ScyllaDB)
- **Node.js 20+** (for API)
- **Modern web browser** (for frontend)

## Quick Start (Development Mode - RF=1)

### 1. Clone and Setup

```bash
git clone <this-repo>
cd mini-discord
cp .env.example .env
npm install
```

### 2. Start ScyllaDB (Development)

```bash
# Start ScyllaDB with RF=1 (single node)
docker-compose up -d

# Wait for initialization (check logs)
docker-compose logs -f scylla-init
```

Wait until you see `Schema initialized successfully` in the logs.

### 3. Start API Server

```bash
# Terminal 1: Start API in development mode
npm run dev
```

You should see:
```
Connecting to ScyllaDB at 127.0.0.1 (DC: datacenter1)
Connected to ScyllaDB - DC: datacenter1, Keyspace: chat
Prepared statements ready
API server running on port 3000
```

### 4. Open Frontend

Open `public/index.html` in your browser, or serve it via a simple HTTP server:

```bash
# Terminal 2: Simple HTTP server
cd public
python3 -m http.server 8080
# Then open http://localhost:8080
```

### 5. Test Basic Functionality

1. **Send a message**: Fill the form and click "Send Message"
2. **Load messages**: Click "Load Latest" to see your message
3. **Test pagination**: Send multiple messages, then use "Load Older"

## Cluster Mode (RF=3)

For testing consistency levels and fault tolerance:

### 1. Stop Development Mode

```bash
docker-compose down
```

### 2. Start 3-Node Cluster

```bash
# Start cluster with 3 nodes
docker-compose -f docker-compose.cluster.yml up -d

# Wait for all nodes to be ready
docker-compose -f docker-compose.cluster.yml logs -f scylla-cluster-init
```

Wait until you see `Cluster schema initialized successfully`.

### 3. Update Environment

Update `.env` to use cluster-aware settings if needed, then restart the API:

```bash
npm run dev
```

### 4. Test Consistency Levels

Now you can test different consistency levels:
- **ONE**: Fast writes/reads, may be inconsistent during node failures
- **QUORUM**: Balanced approach, majority of nodes must agree
- **ALL**: Strong consistency, all nodes must respond (may fail if a node is down)

## Automated Testing

### Unit and Integration Tests

```bash
# Install test dependencies
npm install

# Run unit tests (no API required)
npm test -- tests/unit/

# Run integration tests (requires running API)
# Terminal 1: Start services
docker-compose up -d
npm run dev

# Terminal 2: Run integration tests
npm test -- tests/integration/

# Run all tests (if API is running)
npm test

# Quick test runner script
./scripts/run-tests.sh
```

### ScyllaDB Concepts Test Script

```bash
# Make sure API and ScyllaDB are running
docker-compose up -d
npm run dev

# Run all concept tests
./scripts/test-scylla-concepts.sh

# Run specific concept tests
./scripts/test-scylla-concepts.sh lwt
./scripts/test-scylla-concepts.sh consistency
./scripts/test-scylla-concepts.sh pagination
./scripts/test-scylla-concepts.sh partitioning
./scripts/test-scylla-concepts.sh performance
```

### Frontend Tests

Open `tests/frontend/frontend-tests.html` in your browser and click "🚀 RUN ALL TESTS" for comprehensive frontend validation.

## Manual Testing Scenarios

### 1. Idempotency (LWT) Test

```bash
# Test duplicate prevention
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": "test",
    "user_id": "tester",
    "content": "Hello World",
    "client_msg_id": "unique-123"
  }'

# Send same request again - should return deduped:true
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": "test",
    "user_id": "tester",
    "content": "Hello World",
    "client_msg_id": "unique-123"
  }'
```

**Expected**: Second request returns `{"ok": true, "deduped": true}`

### 2. Pagination Test

```bash
# Send multiple messages
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/messages \
    -H "Content-Type: application/json" \
    -d "{\"channel_id\": \"test\", \"user_id\": \"user$i\", \"content\": \"Message $i\"}"
  sleep 1
done

# Get latest 3 messages
curl "http://localhost:3000/api/channels/test/messages?limit=3"

# Use next_before cursor for pagination
curl "http://localhost:3000/api/channels/test/messages?limit=3&before=<message_id_from_previous_response>"
```

**Expected**: 
- First call returns 3 most recent messages
- Second call returns 2 older messages (no overlap)

### 3. Consistency Level Test (Cluster Mode Only)

```bash
# Write with ONE consistency
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": "test",
    "user_id": "tester",
    "content": "Consistency Test",
    "consistency": "ONE"
  }'

# Read with QUORUM consistency immediately
curl "http://localhost:3000/api/channels/test/messages?consistency=QUORUM&limit=1"

# Simulate node failure
docker stop scylla2

# Try reading with ALL (should fail)
curl "http://localhost:3000/api/channels/test/messages?consistency=ALL&limit=1"

# Reading with ONE should still work
curl "http://localhost:3000/api/channels/test/messages?consistency=ONE&limit=1"
```

### 4. Temporal Ordering Test

```bash
# Send messages rapidly
curl -X POST http://localhost:3000/api/messages -H "Content-Type: application/json" -d '{"channel_id": "test", "user_id": "user1", "content": "First"}'
curl -X POST http://localhost:3000/api/messages -H "Content-Type: application/json" -d '{"channel_id": "test", "user_id": "user2", "content": "Second"}'
curl -X POST http://localhost:3000/api/messages -H "Content-Type: application/json" -d '{"channel_id": "test", "user_id": "user3", "content": "Third"}'

# Verify ordering (should be Third, Second, First)
curl "http://localhost:3000/api/channels/test/messages?limit=10"
```

**Expected**: Messages appear in reverse chronological order (newest first)

## API Reference

### POST /api/messages

Create a new message with optional deduplication.

**Request Body:**
```json
{
  "channel_id": "string (1-100 chars, required)",
  "user_id": "string (1-100 chars, required)", 
  "content": "string (1-2000 chars, required)",
  "consistency": "ONE|QUORUM|ALL|... (optional)",
  "client_msg_id": "string (1-100 chars, optional)"
}
```

**Response:**
```json
{
  "ok": true,
  "message_id": "timeuuid"
}
```

**Deduplication Response:**
```json
{
  "ok": true,
  "deduped": true
}
```

### GET /api/channels/:channel_id/messages

Retrieve messages with pagination support.

**Query Parameters:**
- `limit`: Number of messages (1-100, default: 20)
- `before`: TimeUUID cursor for older messages
- `after`: TimeUUID cursor for newer messages  
- `consistency`: Read consistency level (optional)

**Response:**
```json
{
  "ok": true,
  "items": [
    {
      "channel_id": "string",
      "message_id": "timeuuid", 
      "user_id": "string",
      "content": "string",
      "created_at": "ISO timestamp"
    }
  ],
  "page": {
    "next_before": "timeuuid|null"
  }
}
```

### GET /health

Check API and database connectivity.

**Response:**
```json
{
  "ok": true,
  "dc": "datacenter1",
  "keyspace": "chat"
}
```

## Configuration

### Environment Variables (.env)

```bash
SCYLLA_CONTACT_POINTS=127.0.0.1         # Comma-separated ScyllaDB nodes
SCYLLA_DATACENTER=datacenter1            # Data center name
SCYLLA_KEYSPACE=chat                     # Keyspace name
API_PORT=3000                            # API server port
DEFAULT_WRITE_CONSISTENCY=ONE            # Default write consistency
DEFAULT_READ_CONSISTENCY=ONE             # Default read consistency
REQUEST_BODY_LIMIT=1mb                   # Request body size limit
CORS_ORIGIN=*                            # CORS origin (dev only)
USE_SOFT_ERRORS=false                    # Always return HTTP 200 with error payload
```

### Consistency Levels

Supported consistency levels:
- `ANY`, `ONE`, `TWO`, `THREE` - Number-based consistency
- `QUORUM` - Majority of replicas
- `ALL` - All replicas
- `LOCAL_ONE`, `LOCAL_QUORUM` - Datacenter-local variants

## Database Schema

### Keyspace: chat

**Development (RF=1):**
```cql
CREATE KEYSPACE chat 
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
```

**Cluster (RF=3):**
```cql  
CREATE KEYSPACE chat
WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 3};
```

### Table: messages

```cql
CREATE TABLE messages (
    channel_id text,         -- Partition key
    message_id timeuuid,     -- Clustering key (DESC order)
    user_id text,
    content text,
    created_at timestamp,
    PRIMARY KEY ((channel_id), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

### Table: message_dedupe

```cql
CREATE TABLE message_dedupe (
    channel_id text,         -- Partition key
    client_msg_id text,      -- Clustering key
    PRIMARY KEY ((channel_id), client_msg_id)
);
```

## Troubleshooting

### Common Issues

1. **"Database not initialized"**
   - Ensure ScyllaDB is running: `docker-compose ps`
   - Check health: `curl http://localhost:3000/health`
   - View logs: `docker-compose logs scylla`

2. **"Connection timeout"**
   - ScyllaDB may still be starting up (can take 1-2 minutes)
   - Check if port 9042 is accessible: `telnet localhost 9042`

3. **"Schema not found"**
   - Verify init container ran: `docker-compose logs scylla-init`
   - Manually run schema: `docker-compose exec scylla cqlsh -f /init-schema.cql`

4. **Frontend not connecting to API**
   - Check API is running on port 3000: `curl http://localhost:3000/health`
   - Verify CORS_ORIGIN setting in `.env`
   - Open browser dev tools to check for errors

### Performance Tips

1. **Batch Operations**: Group related operations when possible
2. **Consistency Trade-offs**: Use ONE for speed, QUORUM for balance, ALL for critical data
3. **Prepared Statements**: Already implemented for better performance
4. **Connection Pooling**: Handled automatically by cassandra-driver

## Limitations

1. **Security**: No authentication/authorization (dev only)
2. **Error Handling**: Basic error responses (can be enhanced)
3. **Monitoring**: No metrics/observability (logs only)  
4. **Scaling**: Single API instance (no load balancing)
5. **Real-time**: No WebSocket support (polling only)

## Development

### Building for Production

```bash
# Build TypeScript
npm run build

# Start production server  
npm start
```

### Docker API (Optional)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Testing with cqlsh

```bash
# Connect to ScyllaDB
docker-compose exec scylla cqlsh

# View data
USE chat;
SELECT * FROM messages LIMIT 10;
SELECT * FROM message_dedupe LIMIT 10;

# Check replication
DESCRIBE KEYSPACE chat;
```

## License

MIT License - Feel free to modify and use for learning purposes.

---

**Note**: This application is designed for educational purposes to demonstrate ScyllaDB concepts. Do not use in production without proper security, monitoring, and error handling implementations.