/**
 * Integration tests for Vikerraadio Õhtujutt RSS Feed
 *
 * Uses Node.js built-in test runner and mock data from test/mocks/
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseEpisode, generateRSS, stripHtml, escapeXml, clearCache } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = join(__dirname, 'mocks');

// Clear cache before each test suite to ensure isolation
beforeEach(() => {
  clearCache();
});

// Load mock data
async function loadMockData(filename) {
  const path = join(MOCKS_DIR, filename);
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

describe('stripHtml', () => {
  it('should remove HTML tags', () => {
    const result = stripHtml('<p>Hello <strong>World</strong></p>');
    assert.strictEqual(result, 'Hello World');
  });

  it('should decode HTML entities', () => {
    const result = stripHtml('Fish &amp; Chips &lt;3');
    assert.strictEqual(result, 'Fish & Chips <3');
  });

  it('should handle empty input', () => {
    assert.strictEqual(stripHtml(''), '');
    assert.strictEqual(stripHtml(null), '');
    assert.strictEqual(stripHtml(undefined), '');
  });

  it('should trim whitespace', () => {
    const result = stripHtml('  <p>Text</p>  ');
    assert.strictEqual(result, 'Text');
  });
});

describe('escapeXml', () => {
  it('should escape ampersand', () => {
    assert.strictEqual(escapeXml('Fish & Chips'), 'Fish &amp; Chips');
  });

  it('should escape angle brackets', () => {
    assert.strictEqual(escapeXml('<tag>'), '&lt;tag&gt;');
  });

  it('should escape quotes', () => {
    assert.strictEqual(escapeXml('"test"'), '&quot;test&quot;');
    assert.strictEqual(escapeXml("'test'"), '&apos;test&apos;');
  });

  it('should handle empty input', () => {
    assert.strictEqual(escapeXml(''), '');
    assert.strictEqual(escapeXml(null), '');
    assert.strictEqual(escapeXml(undefined), '');
  });

  it('should handle multiple special characters', () => {
    const result = escapeXml('Test & "quote" <tag>');
    assert.strictEqual(result, 'Test &amp; &quot;quote&quot; &lt;tag&gt;');
  });
});

describe('parseEpisode', () => {
  it('should parse episode data from mock file', async () => {
    const data = await loadMockData('getRadioPageData-1609912691.json');
    const episode = parseEpisode(data.pageControlData.mainContent);

    assert.ok(episode, 'Episode should not be null');
    assert.strictEqual(episode.id, 1609912691);
    assert.strictEqual(episode.title, 'Õhtujutt. Piia uurib kelgumäge');
    assert.ok(episode.audioUrl, 'Should have audio URL');
    assert.ok(episode.audioUrl.startsWith('https://'), 'Audio URL should be HTTPS');
    assert.ok(episode.pubDate instanceof Date, 'pubDate should be a Date');
    assert.strictEqual(episode.link, 'https://vikerraadio.err.ee/1609912691');
  });

  it('should return null for null input', () => {
    assert.strictEqual(parseEpisode(null), null);
  });

  it('should return null for episode without audio', () => {
    const episode = parseEpisode({ id: 123, heading: 'Test', medias: [] });
    assert.strictEqual(episode, null);
  });

  it('should handle protocol-relative audio URLs', () => {
    const data = {
      id: 123,
      heading: 'Test',
      medias: [{ src: { file: '//example.com/audio.mp3' }, duration: 300 }]
    };
    const episode = parseEpisode(data);
    assert.strictEqual(episode.audioUrl, 'https://example.com/audio.mp3');
  });

  it('should prefer direct file URL over HLS', () => {
    const data = {
      id: 123,
      heading: 'Test',
      medias: [{
        src: {
          file: 'https://example.com/audio.m4a',
          hls: 'https://example.com/audio.m3u8'
        },
        duration: 300
      }]
    };
    const episode = parseEpisode(data);
    assert.strictEqual(episode.audioUrl, 'https://example.com/audio.m4a');
  });

  it('should fall back to HLS when file is not available', () => {
    const data = {
      id: 123,
      heading: 'Test',
      medias: [{
        src: { hls: 'https://example.com/audio.m3u8' },
        duration: 300
      }]
    };
    const episode = parseEpisode(data);
    assert.strictEqual(episode.audioUrl, 'https://example.com/audio.m3u8');
  });
});

describe('generateRSS', () => {
  const sampleEpisodes = [
    {
      id: 1,
      title: 'Episode One',
      description: 'First episode description',
      audioUrl: 'https://example.com/ep1.mp3',
      pubDate: new Date('2024-01-15T12:00:00Z'),
      imageUrl: 'https://example.com/ep1.jpg',
      duration: 300,
      link: 'https://vikerraadio.err.ee/1'
    },
    {
      id: 2,
      title: 'Episode Two',
      description: 'Second episode description',
      audioUrl: 'https://example.com/ep2.mp3',
      pubDate: new Date('2024-01-14T12:00:00Z'),
      imageUrl: 'https://example.com/ep2.jpg',
      duration: 450,
      link: 'https://vikerraadio.err.ee/2'
    }
  ];

  it('should generate valid XML with declaration', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  });

  it('should include RSS 2.0 with iTunes namespace', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.includes('<rss version="2.0"'));
    assert.ok(rss.includes('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"'));
  });

  it('should include channel metadata', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.includes('<title>Vikerraadio Õhtujutt</title>'));
    assert.ok(rss.includes('<language>et</language>'));
    assert.ok(rss.includes('<itunes:author>Vikerraadio / ERR</itunes:author>'));
    assert.ok(rss.includes('Kids &amp; Family'));
  });

  it('should include atom:link self reference', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.includes('atom:link href="https://example.com/feed.xml" rel="self"'));
  });

  it('should include episode items with required elements', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.includes('<title>Episode One</title>'));
    assert.ok(rss.includes('<title>Episode Two</title>'));
    assert.ok(rss.includes('<enclosure url="https://example.com/ep1.mp3"'));
    assert.ok(rss.includes('<guid isPermaLink="true">https://vikerraadio.err.ee/1</guid>'));
    assert.ok(rss.includes('<itunes:duration>300</itunes:duration>'));
    assert.ok(rss.includes('<itunes:duration>450</itunes:duration>'));
  });

  it('should filter out future episodes', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const episodesWithFuture = [
      ...sampleEpisodes,
      {
        id: 3,
        title: 'Future Episode',
        description: 'Not yet published',
        audioUrl: 'https://example.com/ep3.mp3',
        pubDate: futureDate,
        link: 'https://vikerraadio.err.ee/3'
      }
    ];

    const rss = generateRSS(episodesWithFuture, 'https://example.com/feed.xml');
    assert.ok(!rss.includes('Future Episode'));
    assert.ok(rss.includes('Episode One'));
  });

  it('should handle empty episodes array', () => {
    const rss = generateRSS([], 'https://example.com/feed.xml');
    assert.ok(rss.includes('<rss version="2.0"'));
    assert.ok(rss.includes('<channel>'));
    assert.ok(!rss.includes('<item>'));
  });

  it('should use channel image from first episode', () => {
    const rss = generateRSS(sampleEpisodes, 'https://example.com/feed.xml');
    assert.ok(rss.includes('<itunes:image href="https://example.com/ep1.jpg"'));
  });

  it('should use fallback image when no episode has image', () => {
    const episodesNoImage = sampleEpisodes.map(ep => ({ ...ep, imageUrl: '' }));
    const rss = generateRSS(episodesNoImage, 'https://example.com/feed.xml');
    assert.ok(rss.includes('vikerraadio.err.ee/img/vikerraadio_logo.png'));
  });

  it('should escape XML special characters in content', () => {
    const episodesWithSpecialChars = [{
      id: 1,
      title: 'Test & "Escape" <Characters>',
      description: "It's a test",
      audioUrl: 'https://example.com/ep.mp3',
      pubDate: new Date('2024-01-01'),
      link: 'https://vikerraadio.err.ee/1'
    }];

    const rss = generateRSS(episodesWithSpecialChars, 'https://example.com/feed.xml');
    assert.ok(rss.includes('Test &amp; &quot;Escape&quot; &lt;Characters&gt;'));
    assert.ok(rss.includes('It&apos;s a test'));
  });
});

describe('Integration: Parse mock episodes and generate RSS', async () => {
  it('should parse all mock episode files successfully', async () => {
    const episodeFiles = [
      'getRadioPageData-1609912691.json',
      'getRadioPageData-1609911125.json',
      'getRadioPageData-1609910012.json'
    ];

    const episodes = [];
    for (const file of episodeFiles) {
      const data = await loadMockData(file);
      const episode = parseEpisode(data.pageControlData.mainContent);
      if (episode) {
        episodes.push(episode);
      }
    }

    assert.ok(episodes.length > 0, 'Should parse at least one episode');

    for (const ep of episodes) {
      assert.ok(ep.title, 'Each episode should have a title');
      assert.ok(ep.audioUrl, 'Each episode should have an audio URL');
      assert.ok(ep.pubDate, 'Each episode should have a publication date');
    }
  });

  it('should generate valid RSS from parsed mock episodes', async () => {
    const episodeFiles = [
      'getRadioPageData-1609912691.json',
      'getRadioPageData-1609911125.json',
      'getRadioPageData-1609910012.json'
    ];

    const episodes = [];
    for (const file of episodeFiles) {
      const data = await loadMockData(file);
      const episode = parseEpisode(data.pageControlData.mainContent);
      if (episode) {
        episodes.push(episode);
      }
    }

    const rss = generateRSS(episodes, 'https://example.com/feed.xml');

    // Validate RSS structure
    assert.ok(rss.includes('<?xml'), 'Should have XML declaration');
    assert.ok(rss.includes('<rss'), 'Should have rss element');
    assert.ok(rss.includes('<channel>'), 'Should have channel element');
    assert.ok(rss.includes('</rss>'), 'Should have closing rss tag');

    // Check that episode count matches (minus future episodes)
    const now = new Date();
    const pastEpisodes = episodes.filter(ep => ep.pubDate <= now);
    const itemCount = (rss.match(/<item>/g) || []).length;
    assert.strictEqual(itemCount, pastEpisodes.length, 'RSS item count should match past episodes');
  });
});
