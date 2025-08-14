import fetch from 'node-fetch';

// Add fetch to global scope for tests
(global as any).fetch = fetch;
(global as any).performance = require('perf_hooks').performance;

// Set test-specific environment variables
process.env.SCYLLA_CONTACT_POINTS = process.env.SCYLLA_CONTACT_POINTS || '127.0.0.1';
process.env.SCYLLA_DATACENTER = process.env.SCYLLA_DATACENTER || 'datacenter1';
process.env.SCYLLA_KEYSPACE = process.env.SCYLLA_KEYSPACE || 'chat_test';
process.env.API_PORT = process.env.API_PORT || '3001';
process.env.DEFAULT_WRITE_CONSISTENCY = process.env.DEFAULT_WRITE_CONSISTENCY || 'ONE';
process.env.DEFAULT_READ_CONSISTENCY = process.env.DEFAULT_READ_CONSISTENCY || 'ONE';
process.env.REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '1mb';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
process.env.USE_SOFT_ERRORS = process.env.USE_SOFT_ERRORS || 'false';

// Increase timeout for ScyllaDB operations
jest.setTimeout(30000);