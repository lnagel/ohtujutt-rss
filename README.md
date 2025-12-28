# Vikerraadio Õhtujutt RSS Feed

A simple Node.js server that generates a podcast RSS feed for Vikerraadio's "Õhtujutt" (Evening Story) series - daily Estonian children's bedtime stories from ERR (Eesti Rahvusringhääling / Estonian Public Broadcasting).

## What is Õhtujutt?

Õhtujutt is a beloved Estonian radio program that broadcasts bedtime stories for children every evening at 20:45 on Vikerraadio. The stories are performed by well-known Estonian actors and include fairy tales, adventures, and classic children's literature.

## Features

- Fetches latest episodes from ERR's internal API
- Valid podcast RSS feed format (compatible with all podcast apps)
- In-memory caching (1 hour)
- iTunes podcast metadata
- Zero production dependencies
- Docker deployment via GHCR

## API Endpoints Discovered

During development, I reverse-engineered ERR's internal API by analyzing:
- The yt-dlp ERR extractor ([source](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/err.py))
- The Kodi Jupiter plugin ([source](https://github.com/yllar/plugin.video.jupiter.err.ee))

### ERR API v2 Endpoints

**Base URL:** `https://services.err.ee/api/v2`

1. **Get Content Details**
   ```
   GET /vodContent/getContentPageData?contentId={contentid}
   ```
   Returns detailed metadata and media URLs for a specific episode or series

2. **Get Series List**
   ```
   GET /series/getSeriesData?type={type}
   ```
   Returns all shows for a given type (`audio` or `video`)

## Requirements

- Node.js 25 or later
- Docker (for containerized deployment)

## Local Development

Run the server locally:
```bash
npm run dev
```

This uses `--watch` mode for automatic restarts on file changes.

Then access:
- `http://localhost:8787/feed.xml` - RSS feed
- `http://localhost:8787/` - Info page

## Running Tests

```bash
npm test
```

Uses Node.js built-in test runner with mock data from `test/mocks/`.

## Docker Deployment

### Build and Run Locally

```bash
docker build -t ohtujutt-rss .
docker run -p 8787:8787 ohtujutt-rss
```

### Using Docker Compose

```bash
docker-compose up
```

### Pull from GHCR

```bash
docker pull ghcr.io/lnagel/ohtujutt-rss:latest
docker run -p 8787:8787 ghcr.io/lnagel/ohtujutt-rss:latest
```

## Usage

### Subscribe in Podcast Apps

Add this feed URL to your favorite podcast app:
```
http://your-server:8787/feed.xml
```

**Tested with:**
- Apple Podcasts
- Spotify
- Pocket Casts
- Overcast
- Any RSS-compatible podcast player

## How It Works

1. **Server receives request** for `/feed.xml`
2. **Checks cache** - if feed was generated in last hour, return cached version
3. **Fetches episodes** from ERR API:
   - Gets series data for Õhtujutt (content ID 1038081)
   - Fetches detailed metadata for up to 50 recent episodes
   - Extracts audio URLs, titles, descriptions, images
4. **Generates RSS** - creates valid podcast XML with iTunes tags
5. **Caches response** - stores in memory for 1 hour
6. **Returns feed** to podcast app

## Technical Details

- **Runtime:** Node.js 25+
- **Language:** JavaScript (ES modules)
- **Framework:** Native http module (zero dependencies)
- **Caching:** In-memory (1 hour TTL)
- **Deployment:** Docker via GHCR

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_PORT` | `8787` | HTTP server port |
| `CACHE_DURATION_SECONDS` | `3600` | Feed cache duration in seconds |
| `NODE_ENV` | - | Environment mode |

## Limitations & Notes

- Only fetches the 50 most recent episodes (to keep feed size reasonable)
- Feed updates every hour (due to caching)
- ERR's API is unofficial and could change at any time
- This is a third-party project, not affiliated with ERR

## License

MIT License - Feel free to use and modify!

## Acknowledgments

- **ERR (Eesti Rahvusringhääling)** for creating and broadcasting Õhtujutt
- **yt-dlp team** for documenting ERR's API in their extractor
- **yllar** for the Kodi Jupiter plugin that helped reverse engineer the API

## Links

- [Vikerraadio Õhtujutt](https://vikerraadio.err.ee/ohtujutt_lastele)
- [ERR (Estonian Public Broadcasting)](https://err.ee/)
