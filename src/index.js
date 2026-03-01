/**
 * Vikerraadio Õhtujutt Podcast RSS Feed
 *
 * A simple Node.js HTTP server that fetches children's evening stories from ERR's API
 * and serves them as a valid podcast RSS feed.
 *
 * API Endpoints:
 * - Broadcasts list: https://vikerraadio.err.ee/api/broadcast/broadcasts?seriesContentId=1038081
 *   Returns paginated list of episodes with basic metadata
 * - Episode data: https://vikerraadio.err.ee/api/radio/getRadioPageData?contentId={episodeId}
 *   Returns pageControlData.mainContent with media URLs, heading, scheduleStart, etc.
 */

import { createServer } from 'node:http';
import { fetchWithRetry, getConfig as getHttpConfig } from './http-client.js';
import { getCached, setCache, getCachedBatch, getCacheStats } from './response-cache.js';

const VIKERRAADIO_API_URL = process.env.VIKERRAADIO_API_URL || 'https://vikerraadio.err.ee/api';
const SERIES_CONTENT_ID = process.env.SERIES_CONTENT_ID || '1038081';

// Request timeout for upstream API calls (default: 10s, min: 1s, max: 30s)
const rawFetchTimeout = parseInt(process.env.FETCH_TIMEOUT_SECONDS, 10) || 10;
const FETCH_TIMEOUT_MS = Math.max(1, Math.min(30, rawFetchTimeout)) * 1000;

// Short-lived feed cache to prevent regeneration on rapid requests (30 seconds)
const FEED_CACHE_MS = 30000;
let feedCache = { data: null, timestamp: 0 };

const PORT = process.env.LISTEN_PORT || 8787;

// Security headers for all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'",
};

function getCachedFeed() {
  if (feedCache.data && Date.now() - feedCache.timestamp < FEED_CACHE_MS) {
    return feedCache.data;
  }
  return null;
}

function setCachedFeed(data) {
  feedCache = { data, timestamp: Date.now() };
}

async function handleRequest(req, res) {
  // Support reverse proxy headers (X-Forwarded-*), fall back to Host header or socket address
  const host = req.headers['x-forwarded-host'] || req.headers.host || `${req.socket.localAddress}:${req.socket.localPort}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const url = new URL(req.url, `${proto}://${host}`);

  if (url.pathname === '/feed.xml' || url.pathname === '/') {
    await handleFeedRequest(req, res, url);
  } else if (url.pathname === '/health') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

async function handleFeedRequest(req, res, url) {
  try {
    // Try to get from cache
    let rss = getCachedFeed();

    if (!rss) {
      // Fetch fresh data
      const episodes = await fetchEpisodes();
      const selfUrl = new URL('/feed.xml', url.origin);
      rss = generateRSS(episodes, selfUrl.toString());

      // Store in cache
      setCachedFeed(rss);
    }

    const cacheStats = getCacheStats();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheStats.ttlMs / 1000}`,
    });
    res.end(rss);
  } catch (error) {
    console.error('Error generating feed:', error);
    res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

async function fetchEpisodes() {
  const broadcastsCacheKey = `broadcasts:${SERIES_CONTENT_ID}`;

  // Try to get broadcasts list from cache first
  let broadcastsData = getCached(broadcastsCacheKey);

  if (!broadcastsData) {
    const broadcastsUrl = `${VIKERRAADIO_API_URL}/broadcast/broadcasts?seriesContentId=${SERIES_CONTENT_ID}`;
    try {
      const response = await fetchWithRetry(broadcastsUrl, FETCH_TIMEOUT_MS);
      broadcastsData = await response.json();
      setCache(broadcastsCacheKey, broadcastsData);
    } catch (error) {
      console.error(`Failed to fetch broadcasts: ${error.message}`);
      if (error.status) {
        console.error(`Broadcasts request failed with HTTP ${error.status} — see details above`);
      }
      return [];
    }
  }

  // Extract episode IDs from broadcasts list
  const episodeIds = (broadcastsData.data || [])
    .map(broadcast => broadcast.id)
    .filter(id => id != null);

  // Limit to 50 most recent episodes
  const recentIds = episodeIds.slice(0, 50);

  // Check which episodes are already cached
  const episodeCacheKeys = recentIds.map(id => `episode:${id}`);
  const cachedEpisodes = getCachedBatch(episodeCacheKeys);
  const uncachedIds = recentIds.filter(id => !cachedEpisodes.has(`episode:${id}`));

  const cacheStats = getCacheStats();
  console.log(
    `Episodes: ${cachedEpisodes.size} cached, ${uncachedIds.length} to fetch ` +
    `(cache: ${cacheStats.size}/${cacheStats.maxSize})`
  );

  // Fetch uncached episodes (concurrency-limited with retries)
  const fetchResults = await Promise.all(
    uncachedIds.map(async (id) => {
      const contentUrl = `${VIKERRAADIO_API_URL}/radio/getRadioPageData?contentId=${id}`;
      try {
        const response = await fetchWithRetry(contentUrl, FETCH_TIMEOUT_MS);
        const contentData = await response.json();
        setCache(`episode:${id}`, contentData);
        return { id, data: contentData };
      } catch (error) {
        console.error(`Failed to fetch episode ${id}: ${error.message}`);
        if (error.status) {
          console.error(`Episode ${id} request failed with HTTP ${error.status} — see details above`);
        }
        return { id, data: null };
      }
    })
  );

  // Build a map of freshly fetched episodes for quick lookup
  const failedIds = fetchResults.filter(r => r.data === null).map(r => r.id);
  if (failedIds.length > 0) {
    console.error(
      `Failed to fetch ${failedIds.length}/${uncachedIds.length} episodes: ${failedIds.join(', ')}`
    );
  }

  const fetchedMap = new Map(
    fetchResults
      .filter(r => r.data !== null)
      .map(r => [`episode:${r.id}`, r.data])
  );

  // Combine cached and freshly fetched episodes, preserving order
  const episodes = recentIds
    .map(id => {
      const cacheKey = `episode:${id}`;
      const episodeData = cachedEpisodes.get(cacheKey) || fetchedMap.get(cacheKey);
      if (episodeData) {
        return parseEpisode(episodeData.pageControlData?.mainContent);
      }
      return null;
    })
    .filter(ep => ep !== null);

  return episodes;
}

function parseEpisode(data) {
  if (!data) return null;

  // Extract media URL - prefer direct file for podcast compatibility
  let audioUrl = null;
  if (data.medias && data.medias.length > 0) {
    const src = data.medias[0].src;
    // Use direct file URL (m4a) for podcast players, fall back to HLS
    audioUrl = src?.file || src?.hls;
  }

  if (!audioUrl) return null;

  // Add https: protocol if URL starts with //
  if (audioUrl.startsWith('//')) {
    audioUrl = 'https:' + audioUrl;
  }

  // Extract metadata
  const title = data.heading || 'Untitled';
  const description = data.lead || data.body || '';
  // scheduleStart is Unix timestamp in seconds
  const pubDate = data.scheduleStart ? new Date(data.scheduleStart * 1000) : new Date();
  const imageUrl = data.photos?.[0]?.photoUrlOriginal || '';

  // Get duration if available (in seconds)
  const duration = data.medias?.[0]?.duration || 0;

  return {
    id: data.id,
    title,
    description: stripHtml(description),
    audioUrl,
    pubDate,
    imageUrl,
    duration,
    link: `https://vikerraadio.err.ee/${data.id}`
  };
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function generateRSS(episodes, selfUrl) {
  const now = new Date();
  const nowStr = now.toUTCString();

  // Filter out future episodes
  const pastEpisodes = episodes.filter(ep => ep.pubDate <= now);

  const latestDate = pastEpisodes.length > 0 ? pastEpisodes[0].pubDate.toUTCString() : nowStr;

  // Get a representative image from the first episode
  const channelImage = pastEpisodes.length > 0 && pastEpisodes[0].imageUrl
    ? pastEpisodes[0].imageUrl
    : 'https://vikerraadio.err.ee/img/vikerraadio_logo.png';

  const items = pastEpisodes.map(ep => `
    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${escapeXml(ep.description)}</description>
      <link>${escapeXml(ep.link)}</link>
      <guid isPermaLink="true">${escapeXml(ep.link)}</guid>
      <pubDate>${ep.pubDate.toUTCString()}</pubDate>
      <enclosure url="${escapeXml(ep.audioUrl)}" type="audio/mpeg" length="0" />
      ${ep.imageUrl ? `<itunes:image href="${escapeXml(ep.imageUrl)}" />` : ''}
      ${ep.duration ? `<itunes:duration>${Math.floor(ep.duration)}</itunes:duration>` : ''}
    </item>
  `).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Vikerraadio Õhtujutt</title>
    <description>Igaõhtused lastejutud Vikerraadio Õhtujutu saatest. Eesti Rahvusringhääling (ERR) lastele mõeldud õhtused muinasjutud ja lood.</description>
    <link>https://vikerraadio.err.ee/ohtujutt_lastele</link>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />
    <language>et</language>
    <lastBuildDate>${nowStr}</lastBuildDate>
    <pubDate>${latestDate}</pubDate>
    <itunes:author>Vikerraadio / ERR</itunes:author>
    <itunes:summary>Igaõhtused lastejutud Vikerraadio Õhtujutu saatest. Eesti näitlejate esitatud muinasjutud ja lood lastele.</itunes:summary>
    <itunes:owner>
      <itunes:name>Vikerraadio</itunes:name>
      <itunes:email>info@err.ee</itunes:email>
    </itunes:owner>
    <itunes:image href="${escapeXml(channelImage)}" />
    <itunes:category text="Kids &amp; Family">
      <itunes:category text="Stories for Kids" />
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    ${items}
  </channel>
</rss>`;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Export functions for testing
export { parseEpisode, generateRSS, fetchEpisodes, stripHtml, escapeXml };

// Re-export cache utilities for testing
export { clearCache } from './response-cache.js';

// Only start server if run directly (not imported for tests)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const server = createServer(handleRequest);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(PORT, () => {
    const httpConfig = getHttpConfig();
    const cacheStats = getCacheStats();
    console.log(`Listening on port ${PORT}`);
    console.log(`Feed endpoint: /feed.xml`);
    console.log(
      `Config: ${httpConfig.maxConcurrent} concurrent, ${httpConfig.maxRetries} retries, ` +
      `${cacheStats.ttlMs / 1000}s cache TTL`
    );
  });
}
