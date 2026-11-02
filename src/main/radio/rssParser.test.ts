import assert from 'node:assert/strict'
import test from 'node:test'

const { parsePodcastFeedXml, parseDuration } = (await import(
  new URL('./rssParser.ts', import.meta.url).href
)) as typeof import('./rssParser.ts')

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Demo Podcast</title>
    <description>A &amp; B show</description>
    <itunes:author>Alice</itunes:author>
    <itunes:image href="https://cdn.example.com/cover.jpg"/>
    <link>https://example.com/show</link>
    <item>
      <title><![CDATA[Episode One]]></title>
      <guid>ep-1</guid>
      <pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate>
      <itunes:duration>01:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="123"/>
      <description>First episode</description>
    </item>
    <item>
      <title>Episode Two</title>
      <guid isPermaLink="false">ep-2</guid>
      <itunes:duration>540</itunes:duration>
      <enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Cast</title>
  <subtitle>Sub</subtitle>
  <author><name>Bob</name></author>
  <link href="https://example.com/atom" rel="alternate"/>
  <entry>
    <id>urn:uuid:ep-a</id>
    <title>Atom Episode</title>
    <link href="https://cdn.example.com/a.mp3" rel="enclosure" type="audio/mpeg"/>
    <published>2026-02-01T00:00:00Z</published>
    <summary>Hello</summary>
  </entry>
</feed>`

test('parses RSS podcast feed episodes and metadata', () => {
  const feed = parsePodcastFeedXml(RSS_FIXTURE)
  assert.equal(feed.title, 'Demo Podcast')
  assert.equal(feed.author, 'Alice')
  assert.equal(feed.coverUrl, 'https://cdn.example.com/cover.jpg')
  assert.equal(feed.episodes.length, 2)
  assert.equal(feed.episodes[0].title, 'Episode One')
  assert.equal(feed.episodes[0].mediaUrl, 'https://cdn.example.com/ep1.mp3')
  assert.equal(feed.episodes[0].durationSeconds, 3723)
  assert.equal(feed.episodes[1].durationSeconds, 540)
})

test('parses Atom podcast feed entries', () => {
  const feed = parsePodcastFeedXml(ATOM_FIXTURE)
  assert.equal(feed.title, 'Atom Cast')
  assert.equal(feed.author, 'Bob')
  assert.equal(feed.episodes.length, 1)
  assert.equal(feed.episodes[0].guid, 'urn:uuid:ep-a')
  assert.equal(feed.episodes[0].mediaUrl, 'https://cdn.example.com/a.mp3')
})

test('parseDuration supports seconds and clock forms', () => {
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('1:02'), 62)
  assert.equal(parseDuration('1:02:03'), 3723)
  assert.equal(parseDuration(''), 0)
})
