import { validateConsistency, validatePostMessage, validateGetMessages } from '../../src/validators';

describe('Validators', () => {
  describe('validateConsistency', () => {
    it('should return default consistency when not provided', () => {
      const result = validateConsistency();
      expect(result.value).toBeDefined();
      expect(result.warning).toBeUndefined();
    });

    it('should return correct consistency for valid values', () => {
      const result = validateConsistency('QUORUM');
      expect(result.value).toBeDefined();
      expect(result.warning).toBeUndefined();
    });

    it('should return default with warning for invalid consistency', () => {
      const result = validateConsistency('INVALID');
      expect(result.value).toBeDefined();
      expect(result.warning).toContain('Invalid consistency level');
    });

    it('should handle case insensitive consistency levels', () => {
      const result = validateConsistency('one');
      expect(result.value).toBeDefined();
      expect(result.warning).toBeUndefined();
    });
  });

  describe('validatePostMessage', () => {
    const validMessage = {
      channel_id: 'test-channel',
      user_id: 'test-user',
      content: 'Hello world',
      consistency: 'ONE',
      client_msg_id: 'unique-123'
    };

    it('should validate correct message', () => {
      const result = validatePostMessage(validMessage);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.data).toBeDefined();
    });

    it('should require channel_id', () => {
      const message = { ...validMessage };
      delete (message as any).channel_id;
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('channel_id is required and must be a string');
    });

    it('should require user_id', () => {
      const message = { ...validMessage };
      delete (message as any).user_id;
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('user_id is required and must be a string');
    });

    it('should require content', () => {
      const message = { ...validMessage };
      delete (message as any).content;
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('content is required and must be a string');
    });

    it('should validate channel_id length', () => {
      const message = { ...validMessage, channel_id: 'a'.repeat(101) };
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('channel_id must be between 1 and 100 characters');
    });

    it('should validate user_id length', () => {
      const message = { ...validMessage, user_id: 'a'.repeat(101) };
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('user_id must be between 1 and 100 characters');
    });

    it('should validate content length', () => {
      const message = { ...validMessage, content: 'a'.repeat(2001) };
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('content must be between 1 and 2000 characters');
    });

    it('should validate client_msg_id length when provided', () => {
      const message = { ...validMessage, client_msg_id: 'a'.repeat(101) };
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('client_msg_id must be a string between 1 and 100 characters');
    });

    it('should trim whitespace from fields', () => {
      const message = {
        channel_id: '  test-channel  ',
        user_id: '  test-user  ',
        content: '  Hello world  ',
        client_msg_id: '  unique-123  '
      };
      
      const result = validatePostMessage(message);
      expect(result.valid).toBe(true);
      expect(result.data?.channel_id).toBe('test-channel');
      expect(result.data?.user_id).toBe('test-user');
      expect(result.data?.content).toBe('Hello world');
      expect(result.data?.client_msg_id).toBe('unique-123');
    });
  });

  describe('validateGetMessages', () => {
    it('should validate with default limit', () => {
      const result = validateGetMessages({});
      expect(result.valid).toBe(true);
      expect(result.data?.limit).toBe(20);
    });

    it('should validate custom limit', () => {
      const result = validateGetMessages({ limit: '50' });
      expect(result.valid).toBe(true);
      expect(result.data?.limit).toBe(50);
    });

    it('should reject invalid limit', () => {
      const result = validateGetMessages({ limit: '101' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('limit must be a number between 1 and 100');
    });

    it('should reject both before and after parameters', () => {
      const result = validateGetMessages({ 
        before: '550e8400-e29b-41d4-a716-446655440000',
        after: '550e8400-e29b-41d4-a716-446655440001'
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot use both before and after parameters simultaneously');
    });

    it('should validate UUID format for before parameter', () => {
      const result = validateGetMessages({ before: 'invalid-uuid' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('before parameter must be a valid UUID');
    });

    it('should validate UUID format for after parameter', () => {
      const result = validateGetMessages({ after: 'invalid-uuid' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('after parameter must be a valid UUID');
    });

    it('should accept valid UUID format', () => {
      const result = validateGetMessages({ 
        before: '550e8400-e29b-41d4-a716-446655440000' 
      });
      expect(result.valid).toBe(true);
      expect(result.data?.before).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });
});