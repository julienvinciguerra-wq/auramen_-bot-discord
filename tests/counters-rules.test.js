// Test di counter e regolamento: nessuna connessione a Discord, oggetti simulati.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auramen-counters-')));

const { Collection } = require('discord.js');
const counters = require('../src/systems/counters');
const { buildRulesEmbed } = require('../src/commands/regole');
const { getRulesSettings, updateRulesSettings } = require('../src/commands/regole');

const GUILD = '111111111111111111';

function makeMember(id, { bot = false, status = 'online' } = {}) {
  return { id, user: { id, bot }, presence: { status } };
}

function makeGuild(members) {
  const cache = new Collection(members.map(member => [member.id, member]));
  const channels = new Collection();
  const guild = {
    id: GUILD,
    memberCount: cache.size,
    members: { cache, fetch: async () => cache, me: { permissions: { has: () => true } } },
    channels: {
      cache: channels,
      fetch: async id => channels.get(id) ?? null
    }
  };
  return { guild, channels };
}

function addChannel(channels, name = 'canale') {
  const channel = {
    id: String(100000000000000000n + BigInt(channels.size + 1)),
    name,
    renames: [],
    setName: async next => { channel.renames.push(next); channel.name = next; }
  };
  channels.set(channel.id, channel);
  return channel;
}

test('formato del nome: {count}, spazi e limite di 100 caratteri', () => {
  assert.strictEqual(counters.formatCounterName('Membri: {count}', 42), 'Membri: 42');
  assert.strictEqual(counters.formatCounterName('   ', 7), '7');
  assert.strictEqual(counters.formatCounterName('x'.repeat(200), 1).length, 100);
});

test('conteggio membri, bot e online', async () => {
  const { guild } = makeGuild([
    makeMember('1', { status: 'online' }),
    makeMember('2', { status: 'idle' }),
    makeMember('3', { status: 'offline' }),
    makeMember('4', { bot: true, status: 'online' })
  ]);
  assert.strictEqual(await counters.computeCount(guild, 'membri'), 4);
  assert.strictEqual(await counters.computeCount(guild, 'bot'), 1);
  assert.strictEqual(await counters.computeCount(guild, 'online'), 3);
});

test('online senza dati di presenza: nessun valore inventato', async () => {
  const members = [makeMember('1'), makeMember('2')].map(member => ({ id: member.id, user: member.user }));
  const { guild } = makeGuild(members);
  assert.strictEqual(await counters.computeCount(guild, 'online'), null);
});

test('setup, aggiornamento, limite Discord e rimozione', async () => {
  const { guild, channels } = makeGuild([makeMember('1'), makeMember('2')]);
  const channel = addChannel(channels);

  counters.setCounter(GUILD, 'membri', { channelId: channel.id, template: 'Membri: {count}' });
  assert.strictEqual(counters.getCounterSettings(GUILD).membri.channelId, channel.id);

  const first = await counters.updateCounters(guild);
  assert.deepStrictEqual(first.updated.map(item => item.name), ['Membri: 2']);
  assert.strictEqual(channel.name, 'Membri: 2');

  // stesso valore → nessuna nuova rinomina
  const second = await counters.updateCounters(guild);
  assert.strictEqual(second.updated.length, 0);
  assert.strictEqual(second.skipped[0].reason, 'già aggiornato');

  // valore cambiato ma dentro i 10 minuti → bloccato dal rate limit
  guild.memberCount = 3;
  const third = await counters.updateCounters(guild, { now: Date.now() + 60 * 1000 });
  assert.strictEqual(third.updated.length, 0);
  assert.match(third.skipped[0].reason, /limite Discord/);

  // passati i 10 minuti → aggiorna
  const fourth = await counters.updateCounters(guild, { now: Date.now() + 11 * 60 * 1000 });
  assert.strictEqual(fourth.updated[0].name, 'Membri: 3');

  assert.strictEqual(counters.removeCounter(GUILD, 'membri'), true);
  assert.deepStrictEqual(counters.getCounterSettings(GUILD), {});
  assert.strictEqual(counters.removeCounter(GUILD, 'membri'), false);
});

test('canale mancante: il counter viene saltato senza errori', async () => {
  const { guild } = makeGuild([makeMember('1')]);
  counters.setCounter(GUILD, 'bot', { channelId: '999999999999999999', template: 'Bot: {count}' });
  const result = await counters.updateCounters(guild, { force: true });
  assert.strictEqual(result.updated.length, 0);
  assert.strictEqual(result.skipped[0].reason, 'canale non trovato');
  counters.removeCounter(GUILD, 'bot');
});

test('regolamento: elenco numerato, righe vuote scartate e configurazione salvata', () => {
  const guildId = '222222222222222222';
  const rules = getRulesSettings(guildId);
  assert.ok(rules.title);
  assert.ok(rules.text.length > 0);

  updateRulesSettings(guildId, { title: 'Regolamento test', text: 'Prima regola\n\nSeconda regola' });
  const saved = getRulesSettings(guildId);
  assert.strictEqual(saved.title, 'Regolamento test');

  const embed = buildRulesEmbed(saved).toJSON();
  assert.strictEqual(embed.title, 'Regolamento test');
  assert.match(embed.description, /\*\*1\.\*\* Prima regola/);
  assert.match(embed.description, /\*\*2\.\*\* Seconda regola/);
  assert.ok(!embed.description.includes('**3.**'));

  const empty = buildRulesEmbed({ ...saved, text: '' }).toJSON();
  assert.ok(empty.description.includes(saved.description));
  assert.strictEqual(empty.description.endsWith(saved.description), true);
});
