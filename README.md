# Vikerraadio Õhtujutt RSS Feed

A Cloudflare Worker that generates a podcast RSS feed for Vikerraadio's "Õhtujutt" (Evening Story) series - daily Estonian children's bedtime stories from ERR (Eesti Rahvusringhääling / Estonian Public Broadcasting).

## What is Õhtujutt?

Õhtujutt is a beloved Estonian radio program that broadcasts bedtime stories for children every evening at 20:45 on Vikerraadio. The stories are performed by well-known Estonian actors and include fairy tales, adventures, and classic children's literature.

## Features

- ✅ Fetches latest episodes from ERR's internal API
- ✅ Valid podcast RSS feed format (compatible with all podcast apps)
- ✅ Automatic caching (1 hour)
- ✅ iTunes podcast metadata
- ✅ Deployed on Cloudflare Workers (serverless, global CDN)

## API Endpoints Discovered

During development, I reverse-engineered ERR's internal API by analyzing:
- The yt-dlp ERR extractor ([source](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/err.py))
- The Kodi Jupiter plugin ([source](https://github.com/yllar/plugin.video.jupiter.err.ee))

### ERR API v2 Endpoints

**Base URL:** `https://services.err.ee/api/v2`

1. **Get Category Content**
   ```
   GET /category/getByUrl?url={categoryid}&domain=jupiter.err.ee
   ```
   Returns episodes and content for a specific category (e.g., `ohtujutt_lastele`)

2. **Get Content Details**
   ```
   GET /vodContent/getContentPageData?contentId={contentid}
   ```
   Returns detailed metadata and media URLs for a specific episode

3. **Get Series List**
   ```
   GET /series/getSeriesData?type={type}
   ```
   Returns all shows for a given type (`audio` or `video`)

## Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works!)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Login to Cloudflare:**
   ```bash
   npx wrangler login
   ```

3. **Deploy to Cloudflare Workers:**
   ```bash
   npm run deploy
   ```

   Or for production:
   ```bash
   npm run deploy:production
   ```

4. **Your RSS feed will be available at:**
   ```
   https://ohtujutt-rss.your-subdomain.workers.dev/feed.xml
   ```

### Local Development

Run the worker locally:
```bash
npm run dev
```

Then access:
- `http://localhost:8787/feed.xml` - RSS feed
- `http://localhost:8787/` - Info page

### Custom Domain (Optional)

To use a custom domain:

1. Add a route in `wrangler.toml`:
   ```toml
   [env.production]
   routes = [
     { pattern = "podcast.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

2. Make sure your domain is added to your Cloudflare account

3. Deploy: `npm run deploy:production`

## Usage

### Subscribe in Podcast Apps

Add this feed URL to your favorite podcast app:
```
https://your-worker-url.workers.dev/feed.xml
```

**Tested with:**
- Apple Podcasts
- Spotify
- Pocket Casts
- Overcast
- Any RSS-compatible podcast player

### Example Feed Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Vikerraadio Õhtujutt</title>
    <description>Igaõhtused lastejutud Vikerraadio Õhtujutu saatest...</description>
    <item>
      <title>Õhtujutt. Kõhu mäss, 6. Südame mure</title>
      <enclosure url="https://..." type="audio/mpeg" />
      <pubDate>...</pubDate>
      ...
    </item>
  </channel>
</rss>
```

## How It Works

1. **Worker receives request** for `/feed.xml`
2. **Checks cache** - if feed was generated in last hour, return cached version
3. **Fetches episodes** from ERR API:
   - Gets category data for `ohtujutt_lastele`
   - Fetches detailed metadata for up to 50 recent episodes
   - Extracts audio URLs, titles, descriptions, images
4. **Generates RSS** - creates valid podcast XML with iTunes tags
5. **Caches response** - stores in Cloudflare cache for 1 hour
6. **Returns feed** to podcast app

## Technical Details

- **Runtime:** Cloudflare Workers (V8 isolates)
- **Language:** JavaScript (ES modules)
- **Caching:** Cloudflare Cache API (1 hour TTL)
- **Global:** Deployed to 300+ Cloudflare data centers worldwide
- **Cost:** Free tier supports 100,000 requests/day

## Limitations & Notes

- Only fetches the 50 most recent episodes (to keep feed size reasonable)
- Audio URLs are HLS streams (m3u8 format) - most modern podcast apps support these
- Feed updates every hour (due to caching)
- ERR's API is unofficial and could change at any time
- This is a third-party project, not affiliated with ERR

## License

MIT License - Feel free to use and modify!

## Contributing

Contributions welcome! Some ideas:
- Add episode artwork parsing
- Support for more ERR podcasts/shows
- Better error handling
- Episode length detection
- Archive access for older episodes

## Acknowledgments

- **ERR (Eesti Rahvusringhääling)** for creating and broadcasting Õhtujutt
- **yt-dlp team** for documenting ERR's API in their extractor
- **yllar** for the Kodi Jupiter plugin that helped reverse engineer the API

## Links

- [Vikerraadio Õhtujutt](https://vikerraadio.err.ee/ohtujutt_lastele)
- [ERR (Estonian Public Broadcasting)](https://err.ee/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

---

**Made with ❤️ for Estonian children and families**
