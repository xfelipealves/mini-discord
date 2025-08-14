import express from 'express';
import cors from 'cors';
import { types } from 'cassandra-driver';
import { 
  initializeDatabase, 
  closeDatabase, 
  prepareStatements,
  insertMessage,
  checkDedupe,
  getMessages,
  nowId,
  toTimestamp
} from './db';
import { validateConsistency, validatePostMessage, validateGetMessages } from './validators';
import { 
  PostMessageRequest, 
  PostMessageResponse, 
  GetMessagesQuery,
  GetMessagesResponse,
  ErrorResponse,
  HealthResponse,
  ApiResponse,
  Message
} from './types';

const app = express();
const PORT = process.env.API_PORT || 3000;
const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '1mb';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const USE_SOFT_ERRORS = process.env.USE_SOFT_ERRORS === 'true';

let dbInfo: { dc: string; keyspace: string };

// Middleware
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: BODY_LIMIT }));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Error response helper
function errorResponse(code: string, message: string, details?: any): ErrorResponse {
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
  
  const response: HealthResponse = {
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
    const validation = validatePostMessage(req.body);
    if (!validation.valid) {
      const error = errorResponse('BAD_REQUEST', 'Invalid input', { errors: validation.errors });
      return res.status(USE_SOFT_ERRORS ? 200 : 400).json(error);
    }
    
    const { channel_id, user_id, content, consistency, client_msg_id } = validation.data!;
    
    // Validate consistency
    const consistencyResult = validateConsistency(consistency);
    const writeConsistency = consistencyResult.value;
    
    // Check for deduplication if client_msg_id is provided
    if (client_msg_id) {
      const isUnique = await checkDedupe(channel_id, client_msg_id, writeConsistency);
      
      if (!isUnique) {
        const response: PostMessageResponse = {
          ok: true,
          deduped: true
        };
        return res.json(response);
      }
    }
    
    // Generate message ID and timestamp
    const messageId = nowId();
    const createdAt = toTimestamp(messageId);
    
    // Insert message
    await insertMessage(channel_id, messageId, user_id, content, createdAt, writeConsistency);
    
    const response: PostMessageResponse = {
      ok: true,
      message_id: messageId.toString()
    };
    
    if (consistencyResult.warning) {
      (response as any).warning = consistencyResult.warning;
    }
    
    res.json(response);
    
  } catch (error) {
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
    const validation = validateGetMessages(req.query);
    if (!validation.valid) {
      const error = errorResponse('BAD_REQUEST', 'Invalid query parameters', { errors: validation.errors });
      return res.status(USE_SOFT_ERRORS ? 200 : 400).json(error);
    }
    
    const { limit, before, after, consistency } = validation.data!;
    
    // Validate consistency for read
    const consistencyResult = validateConsistency(consistency || process.env.DEFAULT_READ_CONSISTENCY);
    const readConsistency = consistencyResult.value;
    
    // Get messages
    const rows = await getMessages(channelId, limit, before, after, readConsistency);
    
    // Format response
    const items: Message[] = rows.map(row => ({
      channel_id: row.channel_id,
      message_id: row.message_id.toString(),
      user_id: row.user_id,
      content: row.content,
      created_at: row.created_at.toISOString()
    }));
    
    // Calculate next_before cursor
    const nextBefore = items.length > 0 ? items[items.length - 1].message_id : null;
    
    const response: GetMessagesResponse = {
      ok: true,
      items,
      page: {
        next_before: nextBefore
      }
    };
    
    if (consistencyResult.warning) {
      (response as any).warning = consistencyResult.warning;
    }
    
    res.json(response);
    
  } catch (error) {
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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  const error = errorResponse('INTERNAL', 'Internal server error');
  res.status(USE_SOFT_ERRORS ? 200 : 500).json(error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await closeDatabase();
  process.exit(0);
});

// Export app for testing
export { app };

// Start server
async function start() {
  try {
    // Initialize database
    dbInfo = await initializeDatabase();
    
    // Prepare statements
    await prepareStatements();
    
    // Start HTTP server
    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
      console.log(`CORS origin: ${CORS_ORIGIN}`);
      console.log(`Soft errors mode: ${USE_SOFT_ERRORS}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start server if this file is run directly (not imported for testing)
if (require.main === module) {
  start();
}