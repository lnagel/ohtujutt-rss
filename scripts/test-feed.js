/**
 * Test the feed fetching functionality
 * Usage: npm run test-feed
 */

import { fetchEpisodes, clearCache } from '../src/index.js';

clearCache();
console.log('Cache cleared, fetching episodes...\n');

const episodes = await fetchEpisodes();
console.log(`Episodes found: ${episodes.length}\n`);

if (episodes.length > 0) {
  console.log('Latest 5:');
  episodes.slice(0, 5).forEach(ep =>
    console.log(` - ${ep.pubDate.toISOString().slice(0,10)} ${ep.title}\n   ${ep.audioUrl}`)
  );
  console.log('\nOldest:');
  episodes.slice(-1).forEach(ep =>
    console.log(` - ${ep.pubDate.toISOString().slice(0,10)} ${ep.title}\n   ${ep.audioUrl}`)
  );
} else {
  console.log('No episodes found!');
}
