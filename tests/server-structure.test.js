const test = require('node:test');
const assert = require('node:assert/strict');

const { ROLES, CATEGORIES } = require('../src/systems/server-structure');

test('ruoli senza duplicati e con i due ruoli delle notifiche menzionabili', () => {
  const names = ROLES.map(role => role.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    ROLES.filter(role => role.mentionable).map(role => role.name),
    ['Live', 'Novità video']
  );
});

test('canali senza duplicati, con contenuti e collegamenti', () => {
  const names = CATEGORIES.flatMap(category => category.channels.map(channel => channel.name));
  assert.equal(new Set(names).size, names.length);
  assert.ok(CATEGORIES.every(category => category.channels.length > 0));

  const topics = Object.fromEntries(
    CATEGORIES.flatMap(category => category.channels).map(channel => [channel.name, channel.topic || ''])
  );
  assert.match(topics.youtube, /youtube\.com/);
  assert.match(topics.live, /twitch\.tv/);
  assert.match(topics.tiktok, /tiktok\.com/);
});

test('solo la categoria staff è privata e il pannello ticket è in sola lettura', () => {
  assert.deepEqual(
    CATEGORIES.filter(category => category.private).map(category => category.name),
    ['🛠️ STAFF']
  );

  const panel = CATEGORIES
    .flatMap(category => category.channels)
    .find(channel => channel.name === 'apri-ticket');
  assert.equal(panel.readOnly, true);
});
