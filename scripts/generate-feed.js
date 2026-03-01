/**
 * Generate a static feed.xml file for GitHub Pages deployment
 * Usage: node scripts/generate-feed.js
 *
 * Set FEED_BASE_URL to override the default GitHub Pages URL.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchEpisodes, generateRSS, clearCache } from '../src/index.js';
import { getConfig as getHttpConfig } from '../src/http-client.js';

const baseUrl = process.env.FEED_BASE_URL || 'https://lnagel.github.io/ohtujutt-rss';
const selfUrl = `${baseUrl.replace(/\/$/, '')}/feed.xml`;
const outDir = 'public';

// Log runtime context for CI debugging
const httpConfig = getHttpConfig();
console.log('--- Feed generation started ---');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Node.js: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`HTTP config: ${httpConfig.maxConcurrent} concurrent, ${httpConfig.maxRetries} retries, ${httpConfig.initialRetryDelayMs}ms initial backoff`);
if (process.env.GITHUB_ACTIONS) {
  console.log(`Runner: ${process.env.RUNNER_NAME || 'unknown'} (${process.env.RUNNER_OS || 'unknown'}/${process.env.RUNNER_ARCH || 'unknown'})`);
  console.log(`Region: ${process.env.RUNNER_ENVIRONMENT || 'unknown'}`);
  console.log(`Workflow: ${process.env.GITHUB_WORKFLOW || 'unknown'}, run ${process.env.GITHUB_RUN_ID || 'unknown'} attempt ${process.env.GITHUB_RUN_ATTEMPT || 'unknown'}`);
}

clearCache();

console.log(`Fetching episodes...`);
const startTime = Date.now();
const episodes = await fetchEpisodes();
const elapsed = Date.now() - startTime;
console.log(`Found ${episodes.length} episodes (fetched in ${elapsed}ms)`);

if (episodes.length === 0) {
  console.error('No episodes found, aborting');
  process.exit(1);
}

const rss = generateRSS(episodes, selfUrl);

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/feed.xml`, rss, 'utf-8');
console.log(`Written ${outDir}/feed.xml (${rss.length} bytes)`);
console.log('--- Feed generation completed ---');
