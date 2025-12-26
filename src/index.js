/**
 * Vikerraadio Õhtujutt Podcast RSS Feed
 *
 * This Cloudflare Worker fetches children's evening stories from ERR's API
 * and serves them as a valid podcast RSS feed.
 *
 * API Endpoints discovered:
 * - https://services.err.ee/api/v2/category/getByUrl?url={categoryid}&domain=jupiter.err.ee
 * - https://services.err.ee/api/v2/vodContent/getContentPageData?contentId={contentid}
 * - https://services.err.ee/api/v2/series/getSeriesData?type=audio
 */

const ERR_API_BASE = 'https://services.err.ee/api/v2';
const CATEGORY_URL = 'ohtujutt_lastele';
const DOMAIN = 'jupiter.err.ee';

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
      const rss = generateRSS(episodes);

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
  // First, try to get the category data
  const categoryUrl = `${ERR_API_BASE}/category/getByUrl?url=${CATEGORY_URL}&domain=${DOMAIN}`;

  try {
    const response = await fetch(categoryUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch category: ${response.status}`);
    }

    const data = await response.json();

    // Extract episodes from the front page items
    const items = data.data?.frontPage?.items || [];

    // Fetch detailed information for each episode
    const episodePromises = items.slice(0, 50).map(async (item) => {
      try {
        const contentUrl = `${ERR_API_BASE}/vodContent/getContentPageData?contentId=${item.id}`;
        const contentResponse = await fetch(contentUrl);

        if (!contentResponse.ok) {
          console.error(`Failed to fetch content ${item.id}`);
          return null;
        }

        const contentData = await contentResponse.json();
        return parseEpisode(contentData.data);
      } catch (error) {
        console.error(`Error fetching episode ${item.id}:`, error);
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

  // Extract media URL (prefer HLS, then file)
  let audioUrl = null;
  if (data.medias && data.medias.length > 0) {
    const media = data.medias[0];
    audioUrl = media.src?.hls || media.src?.file;
  }

  if (!audioUrl) return null;

  // Extract metadata
  const title = data.heading || 'Untitled';
  const description = data.lead || data.body || '';
  const pubDate = data.showtime ? new Date(data.showtime) : new Date();
  const imageUrl = data.photos?.[0]?.photoUrlOriginal || '';

  // Get duration if available
  const duration = data.medias?.[0]?.duration || 0;

  return {
    id: data.contentId,
    title,
    description: stripHtml(description),
    audioUrl,
    pubDate,
    imageUrl,
    duration,
    link: `https://vikerraadio.err.ee/ohtujutt_lastele/${data.contentId}`
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

function generateRSS(episodes) {
  const now = new Date().toUTCString();
  const latestDate = episodes.length > 0 ? episodes[0].pubDate.toUTCString() : now;

  // Get a representative image from the first episode
  const channelImage = episodes.length > 0 && episodes[0].imageUrl
    ? episodes[0].imageUrl
    : 'https://vikerraadio.err.ee/img/vikerraadio_logo.png';

  const items = episodes.map(ep => `
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
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Vikerraadio Õhtujutt</title>
    <description>Igaõhtused lastejutud Vikerraadio Õhtujutu saatest. Eesti Rahvusringhääling (ERR) lastele mõeldud õhtused muinasjutud ja lood.</description>
    <link>https://vikerraadio.err.ee/ohtujutt_lastele</link>
    <language>et</language>
    <lastBuildDate>${now}</lastBuildDate>
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
    <itunes:explicit>no</itunes:explicit>
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
