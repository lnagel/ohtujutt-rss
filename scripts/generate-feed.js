/**
 * Generate a static feed.xml file for GitHub Pages deployment
 * Usage: node scripts/generate-feed.js
 *
 * Set FEED_BASE_URL to override the default GitHub Pages URL.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchEpisodes, generateRSS, clearCache } from '../src/index.js';

const baseUrl = process.env.FEED_BASE_URL || 'https://lnagel.github.io/ohtujutt-rss';
const selfUrl = `${baseUrl.replace(/\/$/, '')}/feed.xml`;
const outDir = 'public';

clearCache();

console.log(`Fetching episodes...`);
const episodes = await fetchEpisodes();
console.log(`Found ${episodes.length} episodes`);

if (episodes.length === 0) {
  console.error('No episodes found, aborting');
  process.exit(1);
}

const rss = generateRSS(episodes, selfUrl);

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/feed.xml`, rss, 'utf-8');
console.log(`Written ${outDir}/feed.xml (${rss.length} bytes)`);
