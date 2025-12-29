import pLimit from 'p-limit';

// Configuration with environment variable overrides
const MAX_CONCURRENT_REQUESTS = Math.min(
  Math.max(parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10) || 5, 1),
  20
);
const MAX_RETRIES = Math.min(
  Math.max(parseInt(process.env.MAX_RETRIES, 10) || 2, 0),
  5
);
const INITIAL_RETRY_DELAY_MS = Math.min(
  Math.max(parseInt(process.env.RETRY_DELAY_MS, 10) || 500, 100),
  5000
);

const limit = pLimit(MAX_CONCURRENT_REQUESTS);

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
function isRetryableError(error) {
  // Network errors are retryable
  if (error.name === 'AbortError' || error.name === 'TypeError') {
    return true;
  }

  // HTTP 5xx errors are retryable
  if (error.message?.includes('HTTP 5')) {
    return true;
  }

  // Rate limiting (429) is retryable
  if (error.message?.includes('HTTP 429')) {
    return true;
  }

  // Client errors (4xx except 429) are not retryable
  if (error.message?.includes('HTTP 4')) {
    return false;
  }

  // Default to retryable for unknown errors
  return true;
}

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
        // Exponential backoff: 500ms, 1000ms, 2000ms, ...
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt === MAX_RETRIES;
        const shouldRetry = !isLastAttempt && isRetryableError(error);

        if (shouldRetry) {
          console.error(
            `Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${url}: ${error.message}`
          );
        } else if (!isLastAttempt) {
          // Non-retryable error, throw immediately
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError;
  });
}

/**
 * Get the number of pending requests in the queue
 * @returns {number}
 */
export function getPendingCount() {
  return limit.pendingCount;
}

/**
 * Get the number of currently active requests
 * @returns {number}
 */
export function getActiveCount() {
  return limit.activeCount;
}

/**
 * Get current configuration (for debugging/monitoring)
 * @returns {object}
 */
export function getConfig() {
  return {
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    maxRetries: MAX_RETRIES,
    initialRetryDelayMs: INITIAL_RETRY_DELAY_MS,
  };
}
