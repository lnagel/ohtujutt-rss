/**
 * Tests for the response cache module
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  getCached,
  setCache,
  hasCache,
  deleteCache,
  getCachedBatch,
  getCacheStats,
  clearCache,
  getCacheKeys,
} from '../src/response-cache.js';

describe('response-cache', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const data = { test: 'value', nested: { foo: 'bar' } };
      setCache('test-key', data);
      const retrieved = getCached('test-key');
      assert.deepStrictEqual(retrieved, data);
    });

    it('should return undefined for missing keys', () => {
      const result = getCached('nonexistent');
      assert.strictEqual(result, undefined);
    });

    it('should check if key exists', () => {
      setCache('existing', { data: 1 });
      assert.strictEqual(hasCache('existing'), true);
      assert.strictEqual(hasCache('nonexistent'), false);
    });

    it('should delete specific keys', () => {
      setCache('to-delete', { data: 1 });
      assert.strictEqual(hasCache('to-delete'), true);

      const deleted = deleteCache('to-delete');
      assert.strictEqual(deleted, true);
      assert.strictEqual(hasCache('to-delete'), false);
    });

    it('should return false when deleting nonexistent key', () => {
      const deleted = deleteCache('nonexistent');
      assert.strictEqual(deleted, false);
    });
  });

  describe('batch operations', () => {
    it('should retrieve multiple keys at once', () => {
      setCache('key1', { id: 1 });
      setCache('key2', { id: 2 });
      setCache('key3', { id: 3 });

      const results = getCachedBatch(['key1', 'key2', 'key4']);

      assert.strictEqual(results.size, 2);
      assert.deepStrictEqual(results.get('key1'), { id: 1 });
      assert.deepStrictEqual(results.get('key2'), { id: 2 });
      assert.strictEqual(results.has('key4'), false);
    });

    it('should return empty map for all missing keys', () => {
      const results = getCachedBatch(['missing1', 'missing2']);
      assert.strictEqual(results.size, 0);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct stats', () => {
      clearCache();
      const initialStats = getCacheStats();
      assert.strictEqual(initialStats.size, 0);
      assert.ok(initialStats.maxSize > 0);
      assert.ok(initialStats.ttlMs > 0);

      setCache('item1', { data: 1 });
      setCache('item2', { data: 2 });

      const stats = getCacheStats();
      assert.strictEqual(stats.size, 2);
    });
  });

  describe('clearCache', () => {
    it('should remove all entries', () => {
      setCache('key1', { data: 1 });
      setCache('key2', { data: 2 });
      assert.strictEqual(getCacheStats().size, 2);

      clearCache();
      assert.strictEqual(getCacheStats().size, 0);
    });
  });

  describe('getCacheKeys', () => {
    it('should return all current keys', () => {
      setCache('alpha', { data: 'a' });
      setCache('beta', { data: 'b' });
      setCache('gamma', { data: 'c' });

      const keys = getCacheKeys();
      assert.strictEqual(keys.length, 3);
      assert.ok(keys.includes('alpha'));
      assert.ok(keys.includes('beta'));
      assert.ok(keys.includes('gamma'));
    });
  });

  describe('episode and series caching patterns', () => {
    it('should handle series cache key pattern', () => {
      const seriesData = {
        data: {
          seasonList: { items: [] },
        },
      };
      setCache('series:1038081', seriesData);

      const retrieved = getCached('series:1038081');
      assert.deepStrictEqual(retrieved, seriesData);
    });

    it('should handle episode cache key pattern', () => {
      const episodeData = {
        data: {
          mainContent: {
            id: 123456,
            heading: 'Test Episode',
          },
        },
      };
      setCache('episode:123456', episodeData);

      const retrieved = getCached('episode:123456');
      assert.deepStrictEqual(retrieved, episodeData);
    });

    it('should handle batch retrieval of episode keys', () => {
      for (let i = 1; i <= 5; i++) {
        setCache(`episode:${i}`, { id: i, title: `Episode ${i}` });
      }

      const keys = ['episode:1', 'episode:3', 'episode:5', 'episode:999'];
      const results = getCachedBatch(keys);

      assert.strictEqual(results.size, 3);
      assert.ok(results.has('episode:1'));
      assert.ok(results.has('episode:3'));
      assert.ok(results.has('episode:5'));
      assert.ok(!results.has('episode:999'));
    });
  });

  describe('custom TTL', () => {
    it('should accept custom TTL for specific entries', async () => {
      // Set with very short TTL
      setCache('short-lived', { data: 'temporary' }, 50);
      assert.strictEqual(hasCache('short-lived'), true);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be expired now
      assert.strictEqual(getCached('short-lived'), undefined);
    });
  });
});
