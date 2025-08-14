-- Test schema with SimpleStrategy RF=1
CREATE KEYSPACE IF NOT EXISTS chat_test
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE chat_test;

-- Table for storing chat messages
CREATE TABLE IF NOT EXISTS messages (
    channel_id text,
    message_id timeuuid,
    user_id text,
    content text,
    created_at timestamp,
    PRIMARY KEY ((channel_id), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

-- Table for message deduplication using LWT
CREATE TABLE IF NOT EXISTS message_dedupe (
    channel_id text,
    client_msg_id text,
    PRIMARY KEY ((channel_id), client_msg_id)
);