/**
 * Fetch ERR API data and save to test mocks
 *
 * Usage:
 *   npm run fetch-mock -- broadcast/broadcasts seriesContentId=1038081
 *   npm run fetch-mock -- radio/getRadioPageData contentId=1609910012
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.API_BASE_URL || 'https://vikerraadio.err.ee/api';
const MOCKS_DIR = path.join(__dirname, '..', 'test', 'mocks');

const [,, method, ...paramArgs] = process.argv;

if (!method) {
  console.error('Usage: fetch-mock.js <method> [param=value ...]');
  console.error('Example: fetch-mock.js broadcast/broadcasts seriesContentId=1038081');
  process.exit(1);
}

// Parse params
const params = new URLSearchParams();
for (const arg of paramArgs) {
  const [key, value] = arg.split('=');
  if (key && value) {
    params.set(key, value);
  }
}

const url = `${BASE_URL}/${method}?${params.toString()}`;
const methodName = method.split('/').pop();
const primaryParam = paramArgs[0]?.split('=')[1] || 'default';
const filename = `${methodName}-${primaryParam}.json`;
const filepath = path.join(MOCKS_DIR, filename);

console.log(`Fetching: ${url}`);
console.log(`Saving to: ${filepath}`);

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      // Validate JSON
      JSON.parse(data);
      fs.writeFileSync(filepath, data);
      console.log(`Saved ${data.length} bytes`);
    } catch (e) {
      console.error('Invalid JSON response:', e.message);
      process.exit(1);
    }
  });
}).on('error', (e) => {
  console.error('Request failed:', e.message);
  process.exit(1);
});