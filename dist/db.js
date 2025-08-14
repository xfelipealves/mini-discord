"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowId = nowId;
exports.toTimestamp = toTimestamp;
exports.initializeDatabase = initializeDatabase;
exports.getClient = getClient;
exports.closeDatabase = closeDatabase;
exports.prepareStatements = prepareStatements;
exports.insertMessage = insertMessage;
exports.checkDedupe = checkDedupe;
exports.getMessages = getMessages;
const cassandra_driver_1 = require("cassandra-driver");
let client;
function nowId() {
    return cassandra_driver_1.types.TimeUuid.now();
}
function toTimestamp(messageId) {
    return messageId.getDate();
}
async function initializeDatabase() {
    const contactPoints = (process.env.SCYLLA_CONTACT_POINTS || '127.0.0.1').split(',');
    const localDataCenter = process.env.SCYLLA_DATACENTER || 'datacenter1';
    const keyspace = process.env.SCYLLA_KEYSPACE || 'chat';
    console.log(`Connecting to ScyllaDB at ${contactPoints.join(', ')} (DC: ${localDataCenter})`);
    client = new cassandra_driver_1.Client({
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
    }
    catch (error) {
        console.error('Failed to connect to ScyllaDB:', error);
        throw error;
    }
}
function getClient() {
    if (!client) {
        throw new Error('Database not initialized');
    }
    return client;
}
async function closeDatabase() {
    if (client) {
        await client.shutdown();
    }
}
// Prepared statements
let insertMessageStmt;
let insertDedupeStmt;
let selectMessagesStmt;
let selectMessagesBeforeStmt;
let selectMessagesAfterStmt;
async function prepareStatements() {
    // For now, we'll use direct queries instead of prepared statements
    // This simplifies the implementation and avoids TypeScript issues
    console.log('Statement preparation ready (using direct queries)');
}
async function insertMessage(channelId, messageId, userId, content, createdAt, consistency) {
    const client = getClient();
    const query = 'INSERT INTO messages (channel_id, message_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)';
    await client.execute(query, [channelId, messageId, userId, content, createdAt], {
        consistency,
        prepare: true
    });
}
async function checkDedupe(channelId, clientMsgId, consistency) {
    const client = getClient();
    const query = 'INSERT INTO message_dedupe (channel_id, client_msg_id) VALUES (?, ?) IF NOT EXISTS';
    const result = await client.execute(query, [channelId, clientMsgId], {
        consistency,
        prepare: true
    });
    // Return true if the LWT was applied (not a duplicate)
    return result.rows[0]['[applied]'];
}
async function getMessages(channelId, limit, before, after, consistency = cassandra_driver_1.types.consistencies.one) {
    const client = getClient();
    let query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? LIMIT ?';
    let params = [channelId, limit];
    if (before) {
        query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? AND message_id < ? LIMIT ?';
        params = [channelId, cassandra_driver_1.types.TimeUuid.fromString(before), limit];
    }
    else if (after) {
        query = 'SELECT channel_id, message_id, user_id, content, created_at FROM messages WHERE channel_id = ? AND message_id > ? LIMIT ?';
        params = [channelId, cassandra_driver_1.types.TimeUuid.fromString(after), limit];
    }
    const result = await client.execute(query, params, {
        consistency,
        prepare: true
    });
    return result.rows;
}
