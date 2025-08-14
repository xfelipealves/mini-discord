/**
 * Direct API tests using fetch (requires running API server)
 * Run with: npm run dev (in another terminal) then npm test
 */

describe('ScyllaDB Concepts - Direct API Tests', () => {
  const API_BASE = 'http://localhost:3000';
  
  // Helper function for API requests
  async function apiRequest(method: string, endpoint: string, body?: any) {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json() as any;
    
    return { response, data, status: response.status };
  }
  
  // Check if API is running before tests
  beforeAll(async () => {
    try {
      const { status } = await apiRequest('GET', '/health');
      if (status !== 200) {
        throw new Error('API not responding');
      }
    } catch (error) {
      throw new Error(
        'API server not running. Please start it with: npm run dev\n' +
        'Then run tests with: npm test'
      );
    }
  }, 10000);
  
  describe('1. Health Check', () => {
    it('should return healthy status', async () => {
      const { data, status } = await apiRequest('GET', '/health');
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.dc).toBeDefined();
      expect(data.keyspace).toBeDefined();
    });
  });
  
  describe('2. LWT (Lightweight Transactions)', () => {
    const uniqueId = `test-${Date.now()}`;
    const testMessage = {
      channel_id: 'lwt-test',
      user_id: 'test-user',
      content: 'LWT Test Message',
      client_msg_id: uniqueId
    };
    
    it('should insert message on first attempt', async () => {
      const { data, status } = await apiRequest('POST', '/api/messages', testMessage);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message_id).toBeDefined();
      expect(data.deduped).toBeUndefined();
    });
    
    it('should dedupe message on second attempt', async () => {
      // Send same message again
      const { data, status } = await apiRequest('POST', '/api/messages', testMessage);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.deduped).toBe(true);
      expect(data.message_id).toBeUndefined();
    });
    
    it('should have only one message in database', async () => {
      const { data, status } = await apiRequest('GET', `/api/channels/${testMessage.channel_id}/messages`);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      
      const matchingMessages = data.items.filter((msg: any) => 
        msg.content === testMessage.content
      );
      expect(matchingMessages).toHaveLength(1);
    });
  });
  
  describe('3. Consistency Levels', () => {
    const consistencyLevels = ['ONE', 'QUORUM', 'ALL'];
    
    it.each(consistencyLevels)('should handle %s consistency for writes', async (consistency) => {
      const { data, status } = await apiRequest('POST', '/api/messages', {
        channel_id: 'consistency-test',
        user_id: 'test-user',
        content: `Test ${consistency}`,
        consistency
      });
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message_id).toBeDefined();
    });
    
    it.each(consistencyLevels)('should handle %s consistency for reads', async (consistency) => {
      const { data, status } = await apiRequest('GET', 
        `/api/channels/consistency-test/messages?consistency=${consistency}&limit=1`);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.items)).toBe(true);
    });
    
    it('should handle invalid consistency with warning', async () => {
      const { data, status } = await apiRequest('POST', '/api/messages', {
        channel_id: 'invalid-consistency-test',
        user_id: 'test-user',
        content: 'Invalid consistency test',
        consistency: 'INVALID'
      });
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message_id).toBeDefined();
      expect(data.warning).toContain('Invalid consistency level');
    });
  });
  
  describe('4. Pagination', () => {
    const channelId = 'pagination-test';
    
    beforeAll(async () => {
      // Insert test messages
      for (let i = 1; i <= 10; i++) {
        await apiRequest('POST', '/api/messages', {
          channel_id: channelId,
          user_id: `user-${i}`,
          content: `Message ${i.toString().padStart(2, '0')}`
        });
        // Small delay to ensure different TimeUUIDs
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });
    
    it('should return messages in reverse chronological order', async () => {
      const { data, status } = await apiRequest('GET', `/api/channels/${channelId}/messages?limit=5`);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.items).toHaveLength(5);
      expect(data.page.next_before).toBeDefined();
      
      // Check content ordering (newest first)
      const contents = data.items.map((msg: any) => msg.content);
      expect(contents[0]).toContain('10'); // Most recent
      expect(contents[4]).toContain('06'); // 5th most recent
    });
    
    it('should support before cursor pagination', async () => {
      // Get first page
      const { data: page1 } = await apiRequest('GET', `/api/channels/${channelId}/messages?limit=3`);
      expect(page1.items).toHaveLength(3);
      
      // Get second page
      const { data: page2 } = await apiRequest('GET', 
        `/api/channels/${channelId}/messages?limit=3&before=${page1.page.next_before}`);
      expect(page2.items).toHaveLength(3);
      
      // Verify no overlap
      const page1Ids = page1.items.map((msg: any) => msg.message_id);
      const page2Ids = page2.items.map((msg: any) => msg.message_id);
      const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });
    
    it('should reject both before and after parameters', async () => {
      const { data, status } = await apiRequest('GET', 
        `/api/channels/${channelId}/messages?before=550e8400-e29b-41d4-a716-446655440000&after=550e8400-e29b-41d4-a716-446655440001`);
      
      expect(status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('before and after');
    });
    
    it('should validate UUID format', async () => {
      const { data, status } = await apiRequest('GET', 
        `/api/channels/${channelId}/messages?before=invalid-uuid`);
      
      expect(status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('uuid');
    });
  });
  
  describe('5. Channel Partitioning', () => {
    const channels = ['channel-a', 'channel-b', 'channel-c'];
    
    beforeAll(async () => {
      // Insert messages in different channels
      for (const channel of channels) {
        for (let i = 1; i <= 3; i++) {
          await apiRequest('POST', '/api/messages', {
            channel_id: channel,
            user_id: 'partition-tester',
            content: `${channel} message ${i}`
          });
        }
      }
    });
    
    it.each(channels)('should isolate messages in %s', async (channel) => {
      const { data, status } = await apiRequest('GET', `/api/channels/${channel}/messages`);
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.items).toHaveLength(3);
      
      // All messages should belong to this channel
      data.items.forEach((msg: any) => {
        expect(msg.channel_id).toBe(channel);
        expect(msg.content).toContain(channel);
      });
    });
  });
  
  describe('6. Input Validation', () => {
    const validationTests = [
      {
        name: 'empty channel_id',
        body: { channel_id: '', user_id: 'test', content: 'test' },
        shouldFail: true
      },
      {
        name: 'missing user_id',
        body: { channel_id: 'test', content: 'test' },
        shouldFail: true
      },
      {
        name: 'empty content',
        body: { channel_id: 'test', user_id: 'test', content: '' },
        shouldFail: true
      },
      {
        name: 'too long channel_id',
        body: { channel_id: 'a'.repeat(101), user_id: 'test', content: 'test' },
        shouldFail: true
      },
      {
        name: 'too long content',
        body: { channel_id: 'test', user_id: 'test', content: 'a'.repeat(2001) },
        shouldFail: true
      },
      {
        name: 'valid input',
        body: { channel_id: 'test', user_id: 'test', content: 'valid content' },
        shouldFail: false
      }
    ];
    
    it.each(validationTests)('should handle $name', async ({ body, shouldFail }) => {
      const { data, status } = await apiRequest('POST', '/api/messages', body);
      
      if (shouldFail) {
        expect(status).toBe(400);
        expect(data.ok).toBe(false);
        expect(data.error).toBeDefined();
      } else {
        expect(status).toBe(200);
        expect(data.ok).toBe(true);
        expect(data.message_id).toBeDefined();
      }
    });
  });
  
  describe('7. Performance Tests', () => {
    it('should handle batch insertions', async () => {
      const batchSize = 20;
      const promises = [];
      
      const startTime = performance.now();
      
      for (let i = 0; i < batchSize; i++) {
        promises.push(
          apiRequest('POST', '/api/messages', {
            channel_id: 'batch-test',
            user_id: `batch-user-${i}`,
            content: `Batch message ${i}`,
            client_msg_id: `batch-${Date.now()}-${i}`
          })
        );
      }
      
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const successful = results.filter(r => r.data.ok && r.data.message_id).length;
      const duration = Math.round(endTime - startTime);
      
      expect(successful).toBe(batchSize);
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
      
      console.log(`Batch test: ${successful} messages in ${duration}ms (avg: ${Math.round(duration/batchSize)}ms/msg)`);
    }, 15000);
    
    it('should handle large content', async () => {
      const largeContent = 'A'.repeat(1500) + ' - Large content test';
      
      const { data, status } = await apiRequest('POST', '/api/messages', {
        channel_id: 'large-content-test',
        user_id: 'large-tester',
        content: largeContent
      });
      
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message_id).toBeDefined();
      
      // Verify retrieval
      const { data: getData } = await apiRequest('GET', '/api/channels/large-content-test/messages?limit=1');
      expect(getData.items[0].content).toHaveLength(largeContent.length);
    });
  });
});