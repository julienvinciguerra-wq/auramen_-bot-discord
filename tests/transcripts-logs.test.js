// Test del transcript HTML e dei log (ticket + sanzioni) con oggetti Discord simulati.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Database temporaneo: i test non toccano data/auramen.sqlite del progetto.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auramen-transcripts-')));

const { Collection } = require('discord.js');
const { escapeHtml, buildTicketTranscript, fetchTranscriptMessages } = require('../src/systems/transcripts');
const { sendLog } = require('../src/systems/logger');
const { db, setGuildConfig } = require('../src/database/database');

const GUILD = '111111111111111111';
let seq = 1;

function fakeMessage({ tag = 'utente#0001', content = 'ciao', bot = false, attachments = [], embeds = [], ts = 1700000000000 } = {}) {
  const id = String(100000000000000000n + BigInt(seq++));
  return {
    id,
    createdTimestamp: ts,
    cleanContent: content,
    author: { tag, bot, displayAvatarURL: () => 'https://cdn.example/avatar.png' },
    attachments: new Collection(attachments.map((file, index) => [String(index), file])),
    embeds
  };
}

function fakeChannel(messages, { name = 'ticket-mario', guildName = 'Test Server' } = {}) {
  const collection = new Collection(messages.map(message => [message.id, message]));
  return {
    name,
    guild: { name: guildName },
    messages: { fetch: async () => collection }
  };
}

test('escapeHtml neutralizza i caratteri pericolosi', () => {
  assert.strictEqual(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});

test('fetchTranscriptMessages ordina i messaggi dal più vecchio al più recente', async () => {
  const newer = fakeMessage({ content: 'dopo', ts: 1700000200000 });
  const older = fakeMessage({ content: 'prima', ts: 1700000000000 });
  const channel = fakeChannel([newer, older]);
  const list = await fetchTranscriptMessages(channel);
  assert.deepStrictEqual(list.map(m => m.cleanContent), ['prima', 'dopo']);
});

test('transcript HTML: intestazione, messaggi, escape, allegati e badge bot', async () => {
  const channel = fakeChannel([
    fakeMessage({ tag: 'mario#1111', content: 'Ho un problema con <b>il sito</b>', ts: 1700000000000 }),
    fakeMessage({
      tag: 'auramen bot#3579', bot: true, content: 'Arrivo subito',
      ts: 1700000060000,
      attachments: [{ name: 'foto.png', url: 'https://cdn.example/foto.png' }]
    })
  ]);
  const ticket = { id: 42, opener_id: '100000000000000001', created_at: '2026-11-25 10:00:00', closed_at: '2026-11-25 11:30:00', closed_by: '100000000000000002' };

  const buffer = await buildTicketTranscript(channel, ticket);
  const html = buffer.toString('utf8');

  assert.ok(Buffer.isBuffer(buffer));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Transcript ticket #42/);
  assert.match(html, /Test Server/);
  assert.match(html, /ticket-mario/);
  assert.match(html, /<@100000000000000001>/);
  assert.match(html, /Ho un problema con &lt;b&gt;il sito&lt;\/b&gt;/);
  assert.match(html, /class="badge">BOT</);
  assert.match(html, /foto\.png/);
  assert.match(html, /https:\/\/cdn\.example\/foto\.png/);
  assert.match(html, /Messaggi: 2/);
  assert.doesNotMatch(html, /<script/);
});

test('transcript HTML: ticket vuoto non genera errori', async () => {
  const html = (await buildTicketTranscript(fakeChannel([]), { id: 7, opener_id: '1' })).toString('utf8');
  assert.match(html, /Nessun messaggio nel ticket/);
});

function fakeGuild() {
  const sent = [];
  const channel = {
    id: '333333333333333333',
    isTextBased: () => true,
    send: async payload => { sent.push(payload); }
  };
  return {
    sent,
    guild: { id: GUILD, channels: { fetch: async id => (id === channel.id ? channel : null) } }
  };
}

test('log sanzioni: embed completo su canale moderazione', async () => {
  setGuildConfig(GUILD, { logging: { moderation: '333333333333333333' } });
  const { guild, sent } = fakeGuild();
  await sendLog(guild, 'moderation', 'Sanzione: Timeout', 'Comando: `/moderazione timeout`', [
    { name: 'Utente', value: 'tizio#0001' },
    { name: 'Durata timeout', value: '30 minuti' }
  ]);
  assert.strictEqual(sent.length, 1);
  const embed = sent[0].embeds[0].data;
  assert.strictEqual(embed.title, 'Sanzione: Timeout');
  assert.ok(embed.fields.some(field => field.name === 'Durata timeout' && field.value === '30 minuti'));
});

test('log ticket: usa il canale dedicato configurato con /setup logs categoria:ticket', async () => {
  const { guild, sent } = fakeGuild();
  // Nessun canale in settings.tickets: l'unica sorgente valida è logging.ticket.
  setGuildConfig(GUILD, { logging: { ticket: '333333333333333333' } });

  const tickets = require('../src/systems/tickets');
  await tickets.logTicket(guild, { logChannelId: null, transcriptChannelId: null }, {
    ticket: { id: 1, channel_id: '444444444444444444', opener_id: '100000000000000001' },
    action: 'open', title: 'Ticket aperto', actorId: '100000000000000001'
  });

  assert.strictEqual(sent.length, 1, 'log inviato nel canale ticket');
  const embed = sent[0].embeds[0].data;
  assert.strictEqual(embed.title, 'Ticket aperto');
  assert.ok(embed.fields.some(field => field.name === 'Aperto da'));
  assert.strictEqual(db.prepare("SELECT action FROM ticket_logs WHERE action = 'open'").get().action, 'open');
});
