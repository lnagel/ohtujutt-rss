# Connection Pooling & Response Caching Refactoring Plan

## Current State Analysis

The current implementation has several limitations:
- **No concurrency control**: All 50 episode requests fire simultaneously via `Promise.all()`
- **No retry logic**: Failed requests are simply skipped
- **Feed-level caching**: Only the final RSS XML is cached, so if 5/50 requests fail, the cache is still updated and those 5 episodes are missing until the next full refresh
- **Zero dependencies**: Currently uses only native Node.js APIs

## Proposed Architecture

### 1. Concurrency-Limited HTTP Client with Retries

**Goal**: Max 5 concurrent outbound requests, 2 retries per request with exponential backoff

**Recommended Library**: `p-limit` + custom retry wrapper

**Why `p-limit`?**
- Minimal footprint (~2KB, zero dependencies)
- Well-maintained (sindresorhus ecosystem)
- Simple API: `const limit = pLimit(5); await limit(() => fetch(url))`
- 50M+ weekly downloads, battle-tested

**Alternative considered**: `got` (full HTTP client with built-in retry/timeout)
- Pros: All-in-one solution, excellent retry logic
- Cons: Much larger dependency tree, overkill for this use case

**Retry Strategy**:
```
Attempt 1: immediate
Attempt 2: wait 500ms (on failure)
Attempt 3: wait 1000ms (on failure)
```

### 2. Response-Level Caching (Instead of Feed-Level)

**Goal**: Cache individual API responses so partial failures don't affect already-cached data

**Recommended Library**: `lru-cache`

**Why `lru-cache`?**
- Industry standard for Node.js in-memory caching
- Built-in TTL support per entry
- Memory-bounded with LRU eviction
- Excellent performance characteristics
- 40M+ weekly downloads

**Cache Structure**:
```javascript
// Key: episode ID or "series:{seriesId}"
// Value: { data: apiResponse, fetchedAt: timestamp }

cache.set(`episode:${episodeId}`, response, { ttl: CACHE_TTL_MS });
cache.set(`series:${seriesId}`, seriesData, { ttl: CACHE_TTL_MS });
```

**Benefits**:
- If 5/50 requests fail, the 45 successful ones are cached
- Next feed.xml request only needs to retry those 5 failed episodes
- Much faster recovery from partial failures
- Memory-bounded (won't grow indefinitely)

---

## Implementation Plan

### Step 1: Add Dependencies

```bash
npm install p-limit lru-cache
```

**package.json additions**:
```json
{
  "dependencies": {
    "p-limit": "^6.1.0",
    "lru-cache": "^11.0.0"
  }
}
```

### Step 2: Create HTTP Client Module

**New file**: `src/http-client.js`

```javascript
import pLimit from 'p-limit';

const MAX_CONCURRENT_REQUESTS = 5;
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 500;

const limit = pLimit(MAX_CONCURRENT_REQUESTS);

/**
 * Fetch with concurrency limiting, retries, and timeout
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Request timeout in milliseconds
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, timeoutMs) {
  return limit(async () => {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms, 1000ms
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, { signal: controller.signal });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error.message?.includes('HTTP 4') && !error.message?.includes('HTTP 429')) {
          throw error;
        }

        console.error(`Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${url}: ${error.message}`);
      }
    }

    throw lastError;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for monitoring/testing
export function getPendingCount() {
  return limit.pendingCount;
}

export function getActiveCount() {
  return limit.activeCount;
}
```

### Step 3: Create Response Cache Module

**New file**: `src/response-cache.js`

```javascript
import { LRUCache } from 'lru-cache';

// Environment configuration
const CACHE_TTL_MS = Math.min(
  Math.max(parseInt(process.env.CACHE_DURATION_SECONDS, 10) || 3600, 60),
  86400
) * 1000;

const MAX_CACHE_ENTRIES = 200; // ~50 episodes + series data + buffer

const cache = new LRUCache({
  max: MAX_CACHE_ENTRIES,
  ttl: CACHE_TTL_MS,
  updateAgeOnGet: false,  // Don't extend TTL on reads
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
 */
export function hasCache(key) {
  return cache.has(key);
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
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_ENTRIES,
    calculatedSize: cache.calculatedSize,
  };
}

/**
 * Clear entire cache (useful for testing)
 */
export function clearCache() {
  cache.clear();
}
```

### Step 4: Refactor Episode Fetching Logic

**Changes to `src/index.js`**:

```javascript
import { fetchWithRetry } from './http-client.js';
import { getCached, setCache, getCachedBatch } from './response-cache.js';

async function fetchEpisodes() {
  const seriesCacheKey = `series:${SERIES_CONTENT_ID}`;

  // Try to get series data from cache
  let seriesData = getCached(seriesCacheKey);

  if (!seriesData) {
    const seriesUrl = `${ERR_API_URL}/vodContent/getContentPageData?contentId=${SERIES_CONTENT_ID}`;
    try {
      const response = await fetchWithRetry(seriesUrl, FETCH_TIMEOUT_MS);
      seriesData = await response.json();
      setCache(seriesCacheKey, seriesData);
    } catch (error) {
      console.error(`Failed to fetch series data: ${error.message}`);
      return [];
    }
  }

  // Extract episode IDs (existing logic)
  const seasonList = seriesData?.data?.mainContent?.seasonList || [];
  const allEpisodeIds = seasonList
    .flatMap(season => season.items || [])
    .flatMap(item => item.contents || [])
    .map(content => content.id);

  const recentIds = allEpisodeIds.slice(0, 50);

  // Check which episodes are already cached
  const episodeCacheKeys = recentIds.map(id => `episode:${id}`);
  const cachedEpisodes = getCachedBatch(episodeCacheKeys);

  const uncachedIds = recentIds.filter(id => !cachedEpisodes.has(`episode:${id}`));

  console.log(`Episodes: ${cachedEpisodes.size} cached, ${uncachedIds.length} to fetch`);

  // Fetch uncached episodes (concurrency-limited with retries)
  const fetchPromises = uncachedIds.map(async (id) => {
    const url = `${ERR_API_URL}/vodContent/getContentPageData?contentId=${id}`;
    try {
      const response = await fetchWithRetry(url, FETCH_TIMEOUT_MS);
      const data = await response.json();
      setCache(`episode:${id}`, data);
      return { id, data };
    } catch (error) {
      console.error(`Failed to fetch episode ${id}: ${error.message}`);
      return null;
    }
  });

  const fetchedResults = await Promise.all(fetchPromises);

  // Combine cached and freshly fetched episodes
  const episodes = recentIds
    .map(id => {
      const cacheKey = `episode:${id}`;
      const cached = cachedEpisodes.get(cacheKey);
      if (cached) {
        return parseEpisode(cached);
      }
      const fetched = fetchedResults.find(r => r?.id === id);
      if (fetched) {
        return parseEpisode(fetched.data);
      }
      return null;
    })
    .filter(ep => ep !== null);

  return episodes;
}
```

### Step 5: Remove Feed-Level Cache

The feed-level cache (`feedCache`) can be **removed entirely** since:
1. Response caching handles the expensive operation (API calls)
2. RSS generation is fast and deterministic
3. This allows real-time feed updates when cache is partially refreshed

**Optional**: Keep a short-lived feed cache (30s) to prevent regeneration on every request:

```javascript
// Short-lived feed cache to prevent regeneration on rapid requests
let feedCache = { data: null, timestamp: 0 };
const FEED_CACHE_MS = 30000; // 30 seconds

function getCachedFeed() {
  if (feedCache.data && Date.now() - feedCache.timestamp < FEED_CACHE_MS) {
    return feedCache.data;
  }
  return null;
}
```

### Step 6: Update Package Configuration

**package.json**:
```json
{
  "name": "ohtujutt-rss",
  "version": "1.1.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "lru-cache": "^11.0.0",
    "p-limit": "^6.1.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_REQUESTS` | `5` | Max parallel outbound requests |
| `MAX_RETRIES` | `2` | Retry attempts per request |
| `RETRY_DELAY_MS` | `500` | Initial retry delay (doubles each retry) |
| `CACHE_DURATION_SECONDS` | `3600` | Response cache TTL |
| `FETCH_TIMEOUT_SECONDS` | `10` | Per-request timeout |

---

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| Concurrent requests | Unlimited (~50) | Limited to 5 |
| Retries | None | 2 with exponential backoff |
| Cache granularity | Entire feed | Individual API responses |
| Partial failure recovery | Wait for full TTL | Immediate on next request |
| Memory management | Unbounded | LRU with max entries |
| Dependencies | 0 | 2 (small, well-maintained) |

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/http-client.js` | **Create** - Concurrency-limited fetch with retries |
| `src/response-cache.js` | **Create** - LRU response cache module |
| `src/index.js` | **Modify** - Use new modules, refactor episode fetching |
| `package.json` | **Modify** - Add dependencies |
| `test/feed.test.js` | **Modify** - Add tests for new modules |

---

## Testing Strategy

1. **Unit tests for http-client.js**:
   - Test retry logic with mock failures
   - Test concurrency limiting
   - Test timeout handling

2. **Unit tests for response-cache.js**:
   - Test TTL expiration
   - Test LRU eviction
   - Test batch operations

3. **Integration tests**:
   - Test partial failure recovery
   - Test cache hit/miss scenarios
   - Test concurrent request limiting under load

---

## Rollout Considerations

1. **Backward compatible**: No API changes, only internal improvements
2. **Monitoring**: Add logging for cache hit rates and retry counts
3. **Gradual rollout**: Test with lower concurrency first (3), then increase to 5
