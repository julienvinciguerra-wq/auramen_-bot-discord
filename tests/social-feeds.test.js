const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseYouTubeFeed, parseKickChannel, parseTikTokProfile, sortNewest,
  resolveAccount, resolveCredentials, hasCredentials
} = require('../src/systems/social-feeds');
const { buildFeedEmbed } = require('../src/systems/social-announce');

const YOUTUBE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Minecraft ma &amp; il villaggio è strano</title>
    <published>2026-11-20T15:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>def456</yt:videoId>
    <title>Nuova live</title>
    <published>2026-11-24T18:30:00+00:00</published>
  </entry>
</feed>`;

test('parseYouTubeFeed legge id, titolo e miniature', () => {
  const items = parseYouTubeFeed(YOUTUBE_XML);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'youtube:abc123');
  assert.equal(items[0].title, 'Minecraft ma & il villaggio è strano');
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(items[0].thumbnail, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  assert.equal(items[1].publishedAt, '2026-11-24T18:30:00.000Z');
});

test('parseYouTubeFeed senza video restituisce elenco vuoto', () => {
  assert.deepEqual(parseYouTubeFeed('<feed></feed>'), []);
});

test('parseTikTokProfile estrae i video dal JSON incorporato', () => {
  const payload = {
    __DEFAULT_SCOPE__: {
      'webapp.user-detail': {
        userInfo: {
          itemList: [
            { id: '7412345678901234567', desc: 'Prima clip #auramen', createTime: '1732000000', video: { cover: 'https://cdn.example/cover.jpg' } },
            { id: '7499999999999999999', desc: 'Seconda clip', createTime: '1731000000', video: {} }
          ]
        }
      }
    }
  };
  const html = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script></html>`;
  const items = parseTikTokProfile(html, '@auramen07');

  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'tiktok:7412345678901234567');
  assert.equal(items[0].title, 'Prima clip #auramen');
  assert.equal(items[0].url, 'https://www.tiktok.com/@auramen07/video/7412345678901234567');
  assert.equal(items[0].thumbnail, 'https://cdn.example/cover.jpg');
  assert.equal(items[1].thumbnail, null);
});

test('parseTikTokProfile ripiega sui link presenti nell’HTML', () => {
  const html = '<a href="https://www.tiktok.com/@auramen07/video/7412345678901234567">clip</a>';
  const items = parseTikTokProfile(html, 'auramen07');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'tiktok:7412345678901234567');
  assert.equal(items[0].title, 'Nuovo video su TikTok');
});

test('sortNewest mette i live in cima e poi i più recenti', () => {
  const sorted = sortNewest([
    { id: 'a', live: false, publishedAt: '2026-11-20T10:00:00Z' },
    { id: 'b', live: false, publishedAt: '2026-11-24T10:00:00Z' },
    { id: 'c', live: true, publishedAt: '2026-11-01T10:00:00Z' }
  ]);
  assert.deepEqual(sorted.map(item => item.id), ['c', 'b', 'a']);
});

test('buildFeedEmbed firma l’annuncio con il nome della piattaforma', () => {
  const embed = buildFeedEmbed('tiktok', {
    title: 'Clip nuova',
    url: 'https://www.tiktok.com/@auramen07/video/7412345678901234567',
    thumbnail: 'https://cdn.example/cover.jpg',
    publishedAt: '2026-11-24T10:00:00Z',
    live: false
  }).toJSON();

  assert.equal(embed.author.name, 'TikTok');
  assert.equal(embed.title, 'Clip nuova');
  assert.equal(embed.color, 0xfe2c55);
  assert.equal(embed.image.url, 'https://cdn.example/cover.jpg');
  assert.equal(embed.timestamp, '2026-11-24T10:00:00.000Z');
});

test('resolveAccount usa il predefinito della piattaforma', () => {
  assert.equal(resolveAccount('youtube', 'UC123'), 'UC123');
  assert.ok(resolveAccount('tiktok', null).length > 0);
});

test('parseKickChannel legge la live dall’API ufficiale', () => {
  const payload = {
    data: [{
      slug: 'auramen07',
      stream_title: 'Ranked con voi',
      stream: {
        is_live: true,
        start_time: '2026-11-25T20:00:00Z',
        thumbnail: 'https://cdn.kick/thumb.jpg',
        url: 'https://kick.com/auramen07'
      }
    }]
  };
  const items = parseKickChannel(payload, 'auramen07');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'kick:live:auramen07:2026-11-25T20:00:00Z');
  assert.equal(items[0].title, 'Ranked con voi');
  assert.equal(items[0].url, 'https://kick.com/auramen07');
  assert.equal(items[0].thumbnail, 'https://cdn.kick/thumb.jpg');
  assert.equal(items[0].live, true);
});

test('parseKickChannel non annuncia nulla se il canale è offline', () => {
  assert.deepEqual(parseKickChannel({ data: [{ slug: 'auramen07', stream: { is_live: false } }] }, 'auramen07'), []);
  assert.deepEqual(parseKickChannel({ data: [] }, 'auramen07'), []);
});

test('le credenziali salvate vincono su quelle d’ambiente', () => {
  const creds = resolveCredentials('kick', { clientId: 'id-1', clientSecret: 'secret-1' });
  assert.deepEqual(creds, { clientId: 'id-1', clientSecret: 'secret-1' });
  assert.equal(hasCredentials('kick', { clientId: 'id-1', clientSecret: 'secret-1' }), true);
  assert.equal(hasCredentials('kick', { clientId: 'id-1' }), false);
  assert.equal(hasCredentials('youtube', {}), true);
});
