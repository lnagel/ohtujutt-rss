/**
 * Vikerraadio Õhtujutt Podcast RSS Feed
 *
 * This Cloudflare Worker fetches children's evening stories from ERR's API
 * and serves them as a valid podcast RSS feed.
 *
 * API Endpoints:
 * - Series list: https://services.err.ee/api/v2/vodContent/getContentPageData?contentId=1038081
 *   Returns seasonList.items with episodes organized by year > month > contents
 * - Episode data: https://services.err.ee/api/v2/vodContent/getContentPageData?contentId={episodeId}
 *   Returns mainContent with media URLs, heading, scheduleStart, etc.
 */

const ERR_API_BASE = 'https://services.err.ee/api/v2';
const SERIES_CONTENT_ID = '1038081'; // Õhtujutt series ID

// Cache duration in seconds (1 hour)
const CACHE_DURATION = 3600;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Simple routing
    if (url.pathname === '/feed.xml' || url.pathname === '/') {
      return handleFeedRequest(request, ctx);
    }

    return new Response('Vikerraadio Õhtujutt RSS Feed\n\nEndpoints:\n  /feed.xml - Podcast RSS feed', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function handleFeedRequest(request, ctx) {
  try {
    // Try to get from cache
    const cache = caches.default;
    let response = await cache.match(request);

    if (!response) {
      // Fetch fresh data
      const episodes = await fetchEpisodes();
      const selfUrl = new URL(request.url);
      selfUrl.pathname = '/feed.xml';
      const rss = generateRSS(episodes, selfUrl.toString());

      response = new Response(rss, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_DURATION}`,
        }
      });

      // Store in cache
      if (ctx) {
        ctx.waitUntil(cache.put(request, response.clone()));
      }
    }

    return response;
  } catch (error) {
    console.error('Error generating feed:', error);
    return new Response(`Error generating feed: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
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
