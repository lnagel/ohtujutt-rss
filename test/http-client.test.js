/**
 * Tests for the HTTP client module
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { fetchWithRetry, getPendingCount, getActiveCount, getConfig } from '../src/http-client.js';

describe('http-client', () => {
  describe('getConfig', () => {
    it('should return default configuration', () => {
      const config = getConfig();
      assert.strictEqual(config.maxConcurrent, 5);
      assert.strictEqual(config.maxRetries, 2);
      assert.strictEqual(config.initialRetryDelayMs, 500);
    });
  });

  describe('getPendingCount and getActiveCount', () => {
    it('should return zero when no requests are in flight', () => {
      assert.strictEqual(getPendingCount(), 0);
      assert.strictEqual(getActiveCount(), 0);
    });
  });

  describe('fetchWithRetry', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should succeed on first attempt with valid response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' }),
      };
      globalThis.fetch = mock.fn(async () => mockResponse);

      const response = await fetchWithRetry('https://example.com/api', 5000);
      assert.strictEqual(response.ok, true);
      assert.strictEqual(globalThis.fetch.mock.calls.length, 1);
    });

    it('should retry on 5xx errors', async () => {
      let callCount = 0;
      const errorHeaders = new Map();
      globalThis.fetch = mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: { get: (name) => errorHeaders.get(name) || null },
            text: async () => 'server error',
          };
        }
        return { ok: true, status: 200 };
      });

      const response = await fetchWithRetry('https://example.com/api', 5000);
      assert.strictEqual(response.ok, true);
      assert.strictEqual(callCount, 3);
    });

    it('should not retry on 4xx errors (except 429)', async () => {
      const errorHeaders = new Map([['server', 'nginx']]);
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: (name) => errorHeaders.get(name) || null },
        text: async () => 'not found',
      }));

      await assert.rejects(
        fetchWithRetry('https://example.com/api', 5000),
        /HTTP 404/
      );
      assert.strictEqual(globalThis.fetch.mock.calls.length, 1);
    });

    it('should attach response details to 4xx errors', async () => {
      const errorHeaders = new Map([
        ['server', 'cloudflare'],
        ['cf-ray', '12345-IAD'],
        ['content-type', 'text/html'],
      ]);
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: { get: (name) => errorHeaders.get(name) || null },
        text: async () => '<html>Access Denied</html>',
      }));

      try {
        await fetchWithRetry('https://example.com/api', 5000);
        assert.fail('Expected an error to be thrown');
      } catch (error) {
        assert.strictEqual(error.status, 403);
        assert.strictEqual(error.url, 'https://example.com/api');
        assert.strictEqual(typeof error.elapsedMs, 'number');
        assert.strictEqual(error.responseHeaders.server, 'cloudflare');
        assert.strictEqual(error.responseHeaders['cf-ray'], '12345-IAD');
        assert.ok(error.bodySnippet.includes('Access Denied'));
      }
    });

    it('should retry on 429 rate limit errors', async () => {
      let callCount = 0;
      const errorHeaders = new Map([['retry-after', '1']]);
      globalThis.fetch = mock.fn(async () => {
        callCount++;
        if (callCount < 2) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: { get: (name) => errorHeaders.get(name) || null },
            text: async () => 'rate limited',
          };
        }
        return { ok: true, status: 200 };
      });

      const response = await fetchWithRetry('https://example.com/api', 5000);
      assert.strictEqual(response.ok, true);
      assert.strictEqual(callCount, 2);
    });

    it('should throw after max retries exceeded', async () => {
      const errorHeaders = new Map();
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: (name) => errorHeaders.get(name) || null },
        text: async () => 'server error',
      }));

      await assert.rejects(
        fetchWithRetry('https://example.com/api', 5000),
        /HTTP 500/
      );
      // Default is 2 retries = 3 total attempts
      assert.strictEqual(globalThis.fetch.mock.calls.length, 3);
    });

    it('should handle timeout via AbortController', async () => {
      globalThis.fetch = mock.fn(async (url, options) => {
        // Simulate a slow request
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(resolve, 10000);
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
        return { ok: true, status: 200 };
      });

      await assert.rejects(
        fetchWithRetry('https://example.com/api', 100), // 100ms timeout
        /aborted/i
      );
    });

    it('should handle network errors with retries', async () => {
      let callCount = 0;
      globalThis.fetch = mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('Network error');
          error.name = 'TypeError';
          throw error;
        }
        return { ok: true, status: 200 };
      });

      const response = await fetchWithRetry('https://example.com/api', 5000);
      assert.strictEqual(response.ok, true);
      assert.strictEqual(callCount, 3);
    });
  });
});
