import { Client, types, auth } from 'cassandra-driver';

let client: Client;

export function nowId(): types.TimeUuid {
  return types.TimeUuid.now();
}

export function toTimestamp(messageId: types.TimeUuid): Date {
  return messageId.getDate();
}

export async function initializeDatabase(): Promise<{ dc: string; keyspace: string }> {
  const contactPoints = (process.env.SCYLLA_CONTACT_POINTS || '127.0.0.1').split(',');
  const localDataCenter = process.env.SCYLLA_DATACENTER || 'datacenter1';
  const keyspace = process.env.SCYLLA_KEYSPACE || 'chat';
  
  console.log(`Connecting to ScyllaDB at ${contactPoints.join(', ')} (DC: ${localDataCenter})`);
  
  client = new Client({
    contactPoints,
    localDataCenter,
    keyspace
  });
  
  try {
    await client.connect();
    // Get datacenter info (simplified)
    const dc = localDataCenter; // Use the configured datacenter
    
    console.log(`Connected to ScyllaDB - DC: ${dc}, Keyspace: ${keyspace}`);
    return { dc, keyspace };
  } catch (error) {
    console.error('Failed to connect to ScyllaDB:', error);
    throw error;
  }
}

export function getClient(): Client {
  if (!client) {
    throw new Error('Database not initialized');
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.shutdown();
  }
}

// Prepared statements
let insertMessageStmt: any;
let insertDedupeStmt: any;
let selectMessagesStmt: any;
let selectMessagesBeforeStmt: any;
let selectMessagesAfterStmt: any;

export async function prepareStatements(): Promise<void> {
  // For now, we'll use direct queries instead of prepared statements
  // This simplifies the implementation and avoids TypeScript issues
  console.log('Statement preparation ready (using direct queries)');
}

export async function insertMessage(
  channelId: string,
  messageId: types.TimeUuid,
  userId: string,
  content: string,
  createdAt: Date,
  consistency: number
): Promise<void> {
  const client = getClient();
  const query = 'INSERT INTO messages (channel_id, message_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)';
  await client.execute(query, [channelId, messageId, userId, content, createdAt], {
    consistency,
    prepare: true
  });
}

export async function checkDedupe(
  channelId: string,
  clientMsgId: string,
  consistency: number
): Promise<boolean> {
  const client = getClient();
  const query = 'INSERT INTO message_dedupe (channel_id, client_msg_id) VALUES (?, ?) IF NOT EXISTS';
  const result = await client.execute(query, [channelId, clientMsgId], {
    consistency,
    prepare: true
  });
  
  // Return true if the LWT was applied (not a duplicate)
  return result.rows[0]['[applied]'];
}

export async function getMessages(
  channelId: string,
  limit: number,
  before?: string,
  after?: string,
  consistency: number = types.consistencies.one
): Promise<any[]> {
  const client = getClient();
  let query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? LIMIT ?';
  let params: any[] = [channelId, limit];
  
  if (before) {
    query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? AND message_id < ? LIMIT ?';
    params = [channelId, types.TimeUuid.fromString(before), limit];
  } else if (after) {
    query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? AND message_id > ? LIMIT ?';
    params = [channelId, types.TimeUuid.fromString(after), limit];
  }
  
  const result = await client.execute(query, params, {
    consistency,
    prepare: true
  });
  
  return result.rows;
}