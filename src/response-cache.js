import { LRUCache } from 'lru-cache';

// Environment configuration with validation
const CACHE_TTL_MS =
  Math.min(
    Math.max(parseInt(process.env.CACHE_DURATION_SECONDS, 10) || 3600, 60),
    86400
  ) * 1000;

const MAX_CACHE_ENTRIES = Math.min(
  Math.max(parseInt(process.env.MAX_CACHE_ENTRIES, 10) || 200, 10),
  1000
);

const cache = new LRUCache({
  max: MAX_CACHE_ENTRIES,
  ttl: CACHE_TTL_MS,
  updateAgeOnGet: false, // Don't extend TTL on reads
  updateAgeOnHas: false,
});

/**
 * Get cached API response
 * @param {string} key - Cache key (e.g., "episode:123" or "series:456")
 * @returns {object|undefined}
 */
export function getCached(key) {
  return cache.get(key);
}

/**
 * Cache an API response
 * @param {string} key - Cache key
 * @param {object} data - Response data to cache
 * @param {number} [ttlMs] - Optional custom TTL in milliseconds
 */
export function setCache(key, data, ttlMs) {
  const options = ttlMs ? { ttl: ttlMs } : undefined;
  cache.set(key, data, options);
}

/**
 * Check if key exists in cache (without updating access time)
 * @param {string} key - Cache key
 * @returns {boolean}
 */
export function hasCache(key) {
  return cache.has(key);
}

/**
 * Delete a specific key from cache
 * @param {string} key - Cache key to delete
 * @returns {boolean} - True if key existed and was deleted
 */
export function deleteCache(key) {
  return cache.delete(key);
}

/**
 * Get multiple cached entries at once
 * @param {string[]} keys - Array of cache keys
 * @returns {Map<string, object>} Map of key -> cached data
 */
export function getCachedBatch(keys) {
  const results = new Map();
  for (const key of keys) {
    const data = cache.get(key);
    if (data !== undefined) {
      results.set(key, data);
    }
  }
  return results;
}

/**
 * Get cache statistics for monitoring
 * @returns {object}
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  };
}

/**
 * Clear entire cache
 */
export function clearCache() {
  cache.clear();
}

/**
 * Get all keys currently in cache (for debugging)
 * @returns {string[]}
 */
export function getCacheKeys() {
  return [...cache.keys()];
}
