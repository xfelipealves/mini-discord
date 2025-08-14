import { types } from 'cassandra-driver';
import { nowId, toTimestamp } from '../../src/db';

describe('Database utilities', () => {
  describe('nowId', () => {
    it('should generate a valid TimeUuid', () => {
      const id = nowId();
      expect(id).toBeInstanceOf(types.TimeUuid);
      expect(id.toString()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique IDs', () => {
      const id1 = nowId();
      const id2 = nowId();
      expect(id1.toString()).not.toBe(id2.toString());
    });

    it('should generate IDs in chronological order', () => {
      const id1 = nowId();
      // Small delay to ensure different timestamps
      const id2 = nowId();
      
      const time1 = id1.getDate().getTime();
      const time2 = id2.getDate().getTime();
      expect(time2).toBeGreaterThanOrEqual(time1);
    });
  });

  describe('toTimestamp', () => {
    it('should convert TimeUuid to Date', () => {
      const id = nowId();
      const timestamp = toTimestamp(id);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });

    it('should maintain temporal relationship', () => {
      const id1 = nowId();
      const id2 = nowId();
      
      const time1 = toTimestamp(id1);
      const time2 = toTimestamp(id2);
      
      expect(time2.getTime()).toBeGreaterThanOrEqual(time1.getTime());
    });
  });
});