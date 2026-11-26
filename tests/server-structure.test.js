const test = require('node:test');
const assert = require('node:assert/strict');

const { ROLES, CATEGORIES } = require('../src/systems/server-structure');

const channels = CATEGORIES.flatMap(category => category.channels);

test('ruoli senza duplicati e con i due ruoli delle notifiche menzionabili', () => {
  const names = ROLES.map(role => role.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    ROLES.filter(role => role.mentionable).map(role => role.name),
    ['Live', 'Novità video']
  );
});

test('canali senza duplicati, con contenuti e collegamenti', () => {
  const names = channels.map(channel => channel.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(CATEGORIES.every(category => category.channels.length > 0));

  const topics = Object.fromEntries(channels.map(channel => [channel.name, channel.topic || '']));
  assert.match(topics.youtube, /youtube\.com/);
  assert.match(topics.live, /twitch\.tv/);
  assert.match(topics.tiktok, /tiktok\.com/);
});

test('staff e log sono privati, il pannello ticket è in sola lettura', () => {
  assert.deepEqual(
    CATEGORIES.filter(category => category.private).map(category => category.name),
    ['🛠️ STAFF', '📋 LOG']
  );

  const panel = channels.find(channel => channel.name === 'ticket');
  assert.equal(panel.readOnly, true);
});

test('la categoria GENERAL usa emoji e barra come nel server', () => {
  const general = CATEGORIES.find(category => category.name === '🌐 GENERAL');
  assert.deepEqual(general.channels.map(channel => channel.name), [
    '💬｜chat-generale',
    '🤖｜chat-comandi',
    '📼｜clips-of-the-week',
    '🎥｜video-community',
    '📦｜texture-packs',
    '⏰｜suggerimenti'
  ]);
  assert.deepEqual(
    general.channels.filter(channel => channel.type === 'announcement').map(channel => channel.name),
    ['📦｜texture-packs', '⏰｜suggerimenti']
  );
});

test('i canali richiesti dal bot esistono', () => {
  const names = channels.map(channel => channel.name);
  for (const required of ['ticket', 'conteggio', 'archivio-transcript', 'log-messaggi', 'log-ticket']) {
    assert.ok(names.includes(required), `manca il canale ${required}`);
  }
  assert.ok(channels.some(channel => channel.type === 'voice'));
});
