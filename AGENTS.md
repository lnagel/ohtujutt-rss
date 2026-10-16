# ohtujutt-rss

Podcast RSS feed for Vikerraadio's Õhtujutt

## Where to start
- `src/index.js` — HTTP server, `fetchEpisodes`, `parseEpisode`, `generateRSS`
- `src/http-client.js` — fetch with retries, concurrency, timeout
- `src/response-cache.js` — LRU cache wrapper
- `scripts/generate-feed.js` — produces static `public/feed.xml` for the GitHub Pages publish workflow
- `test/mocks/` — recorded API responses used by tests and during debugging
- `README.md` — user-facing docs (env vars, ports, Docker)

## Dev scripts
- `npm test` — unit tests against mocks
- `npm run dev` — local server on `:8787` with `--watch`
- `npm run test-feed` — hit the live API and print a summary (useful for diagnosing missing episodes)
- `npm run fetch-mock -- <method> <param=value> ...` — refresh a mock (e.g. `broadcast/broadcasts seriesContentId=1038081`)
- `npm run generate` — write static `public/feed.xml`

## Upstream URLs
- Series page: https://vikerraadio.err.ee/ohtujutt_lastele
- Broadcasts list: `https://vikerraadio.err.ee/api/broadcast/broadcasts?seriesContentId=1038081`
- Episode data: `https://vikerraadio.err.ee/api/radio/getRadioPageData?contentId={id}`

ERR's API can change without notice. When the feed shows no new episodes, first verify upstream.
