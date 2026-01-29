# Vikerraadio Õhtujutt RSS Feed

A simple Node.js server that generates a podcast RSS feed for Vikerraadio's "Õhtujutt" (Evening Story) series - daily Estonian children's bedtime stories from ERR (Eesti Rahvusringhääling / Estonian Public Broadcasting).

## What is Õhtujutt?

Õhtujutt is a beloved Estonian radio program that broadcasts bedtime stories for children every evening at 20:45 on Vikerraadio. The stories are performed by well-known Estonian actors and include fairy tales, adventures, and classic children's literature.

## Features

- Fetches latest episodes from Vikerraadio API
- Valid podcast RSS feed format (compatible with all podcast apps)
- In-memory LRU caching with configurable TTL
- Concurrent fetching with retry logic and exponential backoff
- iTunes podcast metadata
- Docker deployment via GHCR

## API Endpoints

**Base URL:** `https://vikerraadio.err.ee/api`

1. **Get Broadcasts List**
   ```
   GET /broadcast/broadcasts?seriesContentId={id}
   ```
   Returns paginated list of episodes for a series

2. **Get Episode Details**
   ```
   GET /radio/getRadioPageData?contentId={id}
   ```
   Returns episode metadata including media URLs

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
2. **Checks cache** - returns cached feed if still valid
3. **Fetches episode list** from `/broadcast/broadcasts` endpoint
4. **Fetches episode details** in parallel (up to 50 episodes, 5 concurrent)
   - Retries failed requests with exponential backoff
   - Extracts audio URLs, titles, descriptions, images
5. **Generates RSS** - creates valid podcast XML with iTunes tags
6. **Caches responses** - both episode list and individual episodes
7. **Returns feed** to podcast app

## Technical Details

- **Runtime:** Node.js 25+
- **Language:** JavaScript (ES modules)
- **Framework:** Native http module
- **Dependencies:** lru-cache, p-limit
- **Caching:** In-memory LRU (1 hour TTL)
- **Deployment:** Docker via GHCR

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LISTEN_PORT` | `8787` | HTTP server port |
| `VIKERRAADIO_API_URL` | `https://vikerraadio.err.ee/api` | Vikerraadio API base URL |
| `SERIES_CONTENT_ID` | `1038081` | Content ID for the podcast series |
| `CACHE_DURATION_SECONDS` | `3600` | Response cache TTL (60-86400) |
| `MAX_CACHE_ENTRIES` | `200` | Maximum cached responses (10-1000) |
| `MAX_CONCURRENT_REQUESTS` | `5` | Parallel API requests (1-20) |
| `MAX_RETRIES` | `2` | Retry attempts for failed requests (0-5) |
| `RETRY_DELAY_MS` | `500` | Initial retry delay, doubles each attempt (100-5000) |
| `FETCH_TIMEOUT_SECONDS` | `10` | Request timeout (1-30) |

## Limitations & Notes

- Only fetches the 50 most recent episodes (to keep feed size reasonable)
- Feed updates every hour (due to caching)
- ERR's API is unofficial and could change at any time
- This is a third-party project, not affiliated with ERR

## License

MIT License - Feel free to use and modify!

## Acknowledgments

- **ERR (Eesti Rahvusringhääling)** for creating and broadcasting Õhtujutt

## Links

- [Vikerraadio Õhtujutt](https://vikerraadio.err.ee/ohtujutt_lastele)
- [ERR (Estonian Public Broadcasting)](https://err.ee/)
