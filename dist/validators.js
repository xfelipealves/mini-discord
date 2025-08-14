"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConsistency = validateConsistency;
exports.validatePostMessage = validatePostMessage;
exports.validateGetMessages = validateGetMessages;
const cassandra_driver_1 = require("cassandra-driver");
const ALLOWED_CONSISTENCIES = [
    'ANY', 'ONE', 'TWO', 'THREE', 'QUORUM', 'ALL',
    'LOCAL_ONE', 'LOCAL_QUORUM'
];
function validateConsistency(consistency) {
    const defaultConsistency = process.env.DEFAULT_WRITE_CONSISTENCY || 'ONE';
    if (!consistency) {
        const defaultValue = cassandra_driver_1.types.consistencies[defaultConsistency.toLowerCase()];
        return { value: defaultValue };
    }
    if (!ALLOWED_CONSISTENCIES.includes(consistency.toUpperCase())) {
        const defaultValue = cassandra_driver_1.types.consistencies[defaultConsistency.toLowerCase()];
        return {
            value: defaultValue,
            warning: `Invalid consistency level '${consistency}', using default '${defaultConsistency}'`
        };
    }
    const consistencyValue = cassandra_driver_1.types.consistencies[consistency.toLowerCase()];
    return { value: consistencyValue };
}
function validatePostMessage(body) {
    const errors = [];
    if (!body.channel_id || typeof body.channel_id !== 'string') {
        errors.push('channel_id is required and must be a string');
    }
    else if (body.channel_id.length < 1 || body.channel_id.length > 100) {
        errors.push('channel_id must be between 1 and 100 characters');
    }
    if (!body.user_id || typeof body.user_id !== 'string') {
        errors.push('user_id is required and must be a string');
    }
    else if (body.user_id.length < 1 || body.user_id.length > 100) {
        errors.push('user_id must be between 1 and 100 characters');
    }
    if (!body.content || typeof body.content !== 'string') {
        errors.push('content is required and must be a string');
    }
    else if (body.content.length < 1 || body.content.length > 2000) {
        errors.push('content must be between 1 and 2000 characters');
    }
    if (body.client_msg_id && (typeof body.client_msg_id !== 'string' ||
        body.client_msg_id.length < 1 || body.client_msg_id.length > 100)) {
        errors.push('client_msg_id must be a string between 1 and 100 characters');
    }
    if (errors.length > 0) {
        return { valid: false, errors };
    }
    return {
        valid: true,
        errors: [],
        data: {
            channel_id: body.channel_id.trim(),
            user_id: body.user_id.trim(),
            content: body.content.trim(),
            consistency: body.consistency?.trim(),
            client_msg_id: body.client_msg_id?.trim()
        }
    };
}
function validateGetMessages(query) {
    const errors = [];
    const limit = query.limit ? parseInt(query.limit) : 20;
    if (isNaN(limit) || limit < 1 || limit > 100) {
        errors.push('limit must be a number between 1 and 100');
    }
    if (query.before && query.after) {
        errors.push('Cannot use both before and after parameters simultaneously');
    }
    // Validate timeuuid format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (query.before && !uuidRegex.test(query.before)) {
        errors.push('before parameter must be a valid UUID');
    }
    if (query.after && !uuidRegex.test(query.after)) {
        errors.push('after parameter must be a valid UUID');
    }
    if (errors.length > 0) {
        return { valid: false, errors };
    }
    return {
        valid: true,
        errors: [],
        data: {
            limit,
            before: query.before,
            after: query.after,
            consistency: query.consistency
        }
    };
}
