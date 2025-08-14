/**
 * Performance tests using direct API calls
 * Requires running API server: npm run dev
 */

describe('Performance Tests - Direct API', () => {
  const API_BASE = 'http://localhost:3000';
  
  async function apiRequest(method: string, endpoint: string, body?: any) {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    
    return { response, data, status: response.status };
  }
  
  beforeAll(async () => {
    // Check if API is running
    try {
      const { status } = await apiRequest('GET', '/health');
      if (status !== 200) {
        throw new Error('API not responding');
      }
    } catch (error) {
      console.warn('Skipping performance tests - API server not running');
      console.warn('Start API with: npm run dev');
      return;
    }
  });
  
  describe('Concurrent Operations', () => {
    it('should handle concurrent message insertions', async () => {
      const concurrentCount = 25;
      const promises = [];
      
      const startTime = performance.now();
      
      for (let i = 0; i < concurrentCount; i++) {
        promises.push(
          apiRequest('POST', '/api/messages', {
            channel_id: 'concurrent-test',
            user_id: `user-${i % 5}`,
            content: `Concurrent message ${i}`,
            client_msg_id: `concurrent-${Date.now()}-${i}`
          })
        );
      }
      
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const successful = results.filter(r => r.data.ok && r.data.message_id).length;
      const duration = Math.round(endTime - startTime);
      
      expect(successful).toBe(concurrentCount);
      expect(duration).toBeLessThan(15000); // Less than 15 seconds
      
      console.log(`🚀 Concurrent: ${successful} messages in ${duration}ms (${Math.round(duration/successful)}ms avg)`);
    }, 20000);
    
    it('should handle LWT deduplication under load', async () => {
      const uniqueMessages = 15;
      const duplicatesPerMessage = 4;
      const promises = [];
      
      const startTime = performance.now();
      
      for (let i = 0; i < uniqueMessages; i++) {
        for (let j = 0; j < duplicatesPerMessage; j++) {
          promises.push(
            apiRequest('POST', '/api/messages', {
              channel_id: 'lwt-perf-test',
              user_id: 'lwt-perf-user',
              content: `LWT perf message ${i}`,
              client_msg_id: `lwt-perf-${i}` // Same ID for duplicates
            })
          );
        }
      }
      
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const insertions = results.filter(r => r.data.message_id).length;
      const deduplications = results.filter(r => r.data.deduped).length;
      const duration = Math.round(endTime - startTime);
      
      expect(insertions).toBe(uniqueMessages);
      expect(deduplications).toBe(uniqueMessages * (duplicatesPerMessage - 1));
      
      console.log(`🔒 LWT: ${insertions} inserts, ${deduplications} deduped in ${duration}ms`);
    }, 25000);
  });
  
  describe('Pagination Performance', () => {
    const channelId = 'pagination-perf';
    
    beforeAll(async () => {
      // Insert test data
      console.log('Setting up pagination test data...');
      const batchSize = 10;
      const totalBatches = 5; // 50 total messages
      
      for (let batch = 0; batch < totalBatches; batch++) {
        const promises = [];
        
        for (let i = 0; i < batchSize; i++) {
          const messageNum = batch * batchSize + i + 1;
          promises.push(
            apiRequest('POST', '/api/messages', {
              channel_id: channelId,
              user_id: `perf-user-${messageNum % 10}`,
              content: `Perf pagination message ${messageNum.toString().padStart(3, '0')}`
            })
          );
        }
        
        await Promise.all(promises);
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between batches
      }
    }, 30000);
    
    it('should paginate efficiently through large dataset', async () => {
      const pageSize = 10;
      let currentCursor = null;
      let totalRetrieved = 0;
      let pageCount = 0;
      const pageTimes = [];
      
      const fullStartTime = performance.now();
      
      while (pageCount < 5) { // Test 5 pages max
        const pageStartTime = performance.now();
        
        const query = `limit=${pageSize}${currentCursor ? `&before=${currentCursor}` : ''}`;
        const { data, status } = await apiRequest('GET', `/api/channels/${channelId}/messages?${query}`);
        
        const pageEndTime = performance.now();
        const pageTime = Math.round(pageEndTime - pageStartTime);
        pageTimes.push(pageTime);
        
        expect(status).toBe(200);
        expect(data.ok).toBe(true);
        
        if (data.items.length === 0) break;
        
        totalRetrieved += data.items.length;
        pageCount++;
        currentCursor = data.page.next_before;
        
        if (!currentCursor) break;
      }
      
      const fullEndTime = performance.now();
      const totalTime = Math.round(fullEndTime - fullStartTime);
      const avgPageTime = Math.round(pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length);
      
      expect(totalRetrieved).toBeGreaterThan(0);
      expect(pageCount).toBeGreaterThan(0);
      expect(avgPageTime).toBeLessThan(1000); // Less than 1 second per page
      
      console.log(`📄 Pagination: ${totalRetrieved} messages across ${pageCount} pages in ${totalTime}ms (${avgPageTime}ms avg/page)`);
    }, 15000);
  });
  
  describe('Consistency Performance', () => {
    it('should compare consistency levels performance', async () => {
      const consistencyLevels = ['ONE', 'QUORUM'];
      const results: { [key: string]: number } = {};
      const messageCount = 10;
      
      for (const consistency of consistencyLevels) {
        const startTime = performance.now();
        const promises = [];
        
        // Write test
        for (let i = 0; i < messageCount; i++) {
          promises.push(
            apiRequest('POST', '/api/messages', {
              channel_id: `consistency-perf-${consistency.toLowerCase()}`,
              user_id: 'consistency-perf-user',
              content: `Consistency ${consistency} message ${i}`,
              consistency
            })
          );
        }
        
        await Promise.all(promises);
        
        // Read test
        const { data } = await apiRequest('GET', 
          `/api/channels/consistency-perf-${consistency.toLowerCase()}/messages?consistency=${consistency}&limit=${messageCount}`);
        
        const endTime = performance.now();
        results[consistency] = Math.round(endTime - startTime);
        
        expect(data.ok).toBe(true);
        expect(data.items).toHaveLength(messageCount);
      }
      
      console.log('⚖️  Consistency Performance:', results);
      
      // ONE should generally be faster than QUORUM
      expect(results.ONE).toBeLessThan(10000); // Less than 10 seconds
      expect(results.QUORUM).toBeLessThan(15000); // Less than 15 seconds
    }, 20000);
  });
  
  describe('Memory and Resource Usage', () => {
    it('should handle varying message sizes efficiently', async () => {
      const sizes = [100, 500, 1000, 1500]; // Character counts
      const results: { [key: number]: number } = {};
      
      for (const size of sizes) {
        const content = 'A'.repeat(size - 20) + ` - Size test ${size}`;
        
        const startTime = performance.now();
        
        const { data, status } = await apiRequest('POST', '/api/messages', {
          channel_id: 'size-test',
          user_id: 'size-tester',
          content
        });
        
        const endTime = performance.now();
        results[size] = Math.round(endTime - startTime);
        
        expect(status).toBe(200);
        expect(data.ok).toBe(true);
        expect(data.message_id).toBeDefined();
      }
      
      console.log('📏 Message Size Performance:', results);
      
      // Performance shouldn't degrade significantly with size
      Object.values(results).forEach(time => {
        expect(time).toBeLessThan(2000); // Less than 2 seconds each
      });
    });
    
    it('should handle multiple channels efficiently', async () => {
      const channelCount = 10;
      const messagesPerChannel = 5;
      const promises = [];
      
      const startTime = performance.now();
      
      for (let c = 0; c < channelCount; c++) {
        for (let m = 0; m < messagesPerChannel; m++) {
          promises.push(
            apiRequest('POST', '/api/messages', {
              channel_id: `multi-channel-${c}`,
              user_id: `multi-user-${m}`,
              content: `Multi-channel message ${c}-${m}`
            })
          );
        }
      }
      
      const results = await Promise.all(promises);
      const endTime = performance.now();
      
      const successful = results.filter(r => r.data.ok).length;
      const duration = Math.round(endTime - startTime);
      
      expect(successful).toBe(channelCount * messagesPerChannel);
      
      console.log(`🏗️  Multi-channel: ${successful} messages across ${channelCount} channels in ${duration}ms`);
      
      // Verify partitioning works correctly
      for (let c = 0; c < 3; c++) { // Test first 3 channels
        const { data } = await apiRequest('GET', `/api/channels/multi-channel-${c}/messages`);
        expect(data.items).toHaveLength(messagesPerChannel);
        data.items.forEach((msg: any) => {
          expect(msg.channel_id).toBe(`multi-channel-${c}`);
        });
      }
    }, 25000);
  });
});