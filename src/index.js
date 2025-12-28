/**
 * Vikerraadio Õhtujutt Podcast RSS Feed
 *
 * A simple Node.js HTTP server that fetches children's evening stories from ERR's API
 * and serves them as a valid podcast RSS feed.
 *
 * API Endpoints:
 * - Series list: https://services.err.ee/api/v2/vodContent/getContentPageData?contentId=1038081
 *   Returns seasonList.items with episodes organized by year > month > contents
 * - Episode data: https://services.err.ee/api/v2/vodContent/getContentPageData?contentId={episodeId}
 *   Returns mainContent with media URLs, heading, scheduleStart, etc.
 */

import { createServer } from 'node:http';

const ERR_API_BASE = 'https://services.err.ee/api/v2';
const SERIES_CONTENT_ID = '1038081'; // Õhtujutt series ID

// Cache duration in milliseconds (1 hour)
const CACHE_DURATION_MS = 3600 * 1000;

// In-memory cache
let feedCache = { data: null, timestamp: 0 };

const PORT = process.env.PORT || 8787;

function getCachedFeed() {
  if (feedCache.data && Date.now() - feedCache.timestamp < CACHE_DURATION_MS) {
    return feedCache.data;
  }
  return null;
}

function setCachedFeed(data) {
  feedCache = { data, timestamp: Date.now() };
}

async function handleRequest(req, res) {
  // Use Host header if present, otherwise derive from socket address
  const host = req.headers.host || `${req.socket.localAddress}:${req.socket.localPort}`;
  const url = new URL(req.url, `http://${host}`);

  if (url.pathname === '/feed.xml' || url.pathname === '/') {
    await handleFeedRequest(req, res, url);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Vikerraadio Õhtujutt RSS Feed\n\nEndpoints:\n  /feed.xml - Podcast RSS feed');
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

    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_DURATION_MS / 1000}`,
    });
    res.end(rss);
  } catch (error) {
    console.error('Error generating feed:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error generating feed: ${error.message}`);
  }
}

async function fetchEpisodes() {
  // Fetch series data to get list of episodes
  const seriesUrl = `${ERR_API_BASE}/vodContent/getContentPageData?contentId=${SERIES_CONTENT_ID}`;

  try {
    const response = await fetch(seriesUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch series: ${response.status}`);
    }

    const data = await response.json();

    // Extract episode IDs from seasonList (organized by year > month > contents)
    const seasonList = data.data?.seasonList?.items || [];
    const episodeIds = [];

    // Flatten the nested structure to get episode IDs
    for (const year of seasonList) {
      for (const month of year.items || []) {
        for (const content of month.contents || []) {
          if (content.id) {
            episodeIds.push(content.id);
          }
        }
      }
    }

    // Limit to 50 most recent episodes and fetch their full data
    const recentIds = episodeIds.slice(0, 50);

    const episodePromises = recentIds.map(async (id) => {
      try {
        const contentUrl = `${ERR_API_BASE}/vodContent/getContentPageData?contentId=${id}`;
        const contentResponse = await fetch(contentUrl);

        if (!contentResponse.ok) {
          console.error(`Failed to fetch content ${id}`);
          return null;
        }

        const contentData = await contentResponse.json();
        return parseEpisode(contentData.data?.mainContent);
      } catch (error) {
        console.error(`Error fetching episode ${id}:`, error);
        return null;
      }
    });

    const episodes = await Promise.all(episodePromises);
    return episodes.filter(ep => ep !== null);
  } catch (error) {
    console.error('Error in fetchEpisodes:', error);
    // Return empty array if we can't fetch
    return [];
  }
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
    console.log(`Listening on port ${PORT}`);
    console.log(`Feed endpoint: /feed.xml`);
  });
}
