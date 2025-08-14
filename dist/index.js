"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const validators_1 = require("./validators");
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.API_PORT || 3000;
const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '1mb';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const USE_SOFT_ERRORS = process.env.USE_SOFT_ERRORS === 'true';
let dbInfo;
// Middleware
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json({ limit: BODY_LIMIT }));
// Request logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});
// Error response helper
function errorResponse(code, message, details) {
    return {
        ok: false,
        error: { code, message, details }
    };
}
// Health endpoint
app.get('/health', (req, res) => {
    if (!dbInfo) {
        const error = errorResponse('SERVICE_UNAVAILABLE', 'Database not initialized');
        return res.status(503).json(error);
    }
    const response = {
        ok: true,
        dc: dbInfo.dc,
        keyspace: dbInfo.keyspace
    };
    res.json(response);
});
// Post message endpoint
app.post('/api/messages', async (req, res) => {
    try {
        // Validate input
        const validation = (0, validators_1.validatePostMessage)(req.body);
        if (!validation.valid) {
            const error = errorResponse('BAD_REQUEST', 'Invalid input', { errors: validation.errors });
            return res.status(USE_SOFT_ERRORS ? 200 : 400).json(error);
        }
        const { channel_id, user_id, content, consistency, client_msg_id } = validation.data;
        // Validate consistency
        const consistencyResult = (0, validators_1.validateConsistency)(consistency);
        const writeConsistency = consistencyResult.value;
        // Check for deduplication if client_msg_id is provided
        if (client_msg_id) {
            const isUnique = await (0, db_1.checkDedupe)(channel_id, client_msg_id, writeConsistency);
            if (!isUnique) {
                const response = {
                    ok: true,
                    deduped: true
                };
                return res.json(response);
            }
        }
        // Generate message ID and timestamp
        const messageId = (0, db_1.nowId)();
        const createdAt = (0, db_1.toTimestamp)(messageId);
        // Insert message
        await (0, db_1.insertMessage)(channel_id, messageId, user_id, content, createdAt, writeConsistency);
        const response = {
            ok: true,
            message_id: messageId.toString()
        };
        if (consistencyResult.warning) {
            response.warning = consistencyResult.warning;
        }
        res.json(response);
    }
    catch (error) {
        console.error('Error posting message:', error);
        const errorResp = errorResponse('INTERNAL', 'Failed to post message');
        res.status(USE_SOFT_ERRORS ? 200 : 500).json(errorResp);
    }
});
// Get messages endpoint
app.get('/api/channels/:channel_id/messages', async (req, res) => {
    try {
        const channelId = req.params.channel_id;
        if (!channelId || channelId.length < 1 || channelId.length > 100) {
            const error = errorResponse('BAD_REQUEST', 'Invalid channel_id');
            return res.status(USE_SOFT_ERRORS ? 200 : 400).json(error);
        }
        // Validate query parameters
        const validation = (0, validators_1.validateGetMessages)(req.query);
        if (!validation.valid) {
            const error = errorResponse('BAD_REQUEST', 'Invalid query parameters', { errors: validation.errors });
            return res.status(USE_SOFT_ERRORS ? 200 : 400).json(error);
        }
        const { limit, before, after, consistency } = validation.data;
        // Validate consistency for read
        const consistencyResult = (0, validators_1.validateConsistency)(consistency || process.env.DEFAULT_READ_CONSISTENCY);
        const readConsistency = consistencyResult.value;
        // Get messages
        const rows = await (0, db_1.getMessages)(channelId, limit, before, after, readConsistency);
        // Format response
        const items = rows.map(row => ({
            channel_id: row.channel_id,
            message_id: row.message_id.toString(),
            user_id: row.user_id,
            content: row.content,
            created_at: row.created_at.toISOString()
        }));
        // Calculate next_before cursor
        const nextBefore = items.length > 0 ? items[items.length - 1].message_id : null;
        const response = {
            ok: true,
            items,
            page: {
                next_before: nextBefore
            }
        };
        if (consistencyResult.warning) {
            response.warning = consistencyResult.warning;
        }
        res.json(response);
    }
    catch (error) {
        console.error('Error getting messages:', error);
        const errorResp = errorResponse('INTERNAL', 'Failed to get messages');
        res.status(USE_SOFT_ERRORS ? 200 : 500).json(errorResp);
    }
});
// 404 handler
app.use((req, res) => {
    const error = errorResponse('NOT_FOUND', 'Endpoint not found');
    res.status(USE_SOFT_ERRORS ? 200 : 404).json(error);
});
// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    const error = errorResponse('INTERNAL', 'Internal server error');
    res.status(USE_SOFT_ERRORS ? 200 : 500).json(error);
});
// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await (0, db_1.closeDatabase)();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await (0, db_1.closeDatabase)();
    process.exit(0);
});
// Start server
async function start() {
    try {
        // Initialize database
        dbInfo = await (0, db_1.initializeDatabase)();
        // Prepare statements
        await (0, db_1.prepareStatements)();
        // Start HTTP server
        app.listen(PORT, () => {
            console.log(`API server running on port ${PORT}`);
            console.log(`CORS origin: ${CORS_ORIGIN}`);
            console.log(`Soft errors mode: ${USE_SOFT_ERRORS}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
// Only start server if this file is run directly (not imported for testing)
if (require.main === module) {
    start();
}
