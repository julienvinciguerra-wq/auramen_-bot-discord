// Test del flusso ticket con oggetti Discord simulati (nessuna connessione a Discord).
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auramen-test-')));
const { PermissionFlagsBits, ChannelType, Collection } = require('discord.js');
const { db } = require('../src/database/database');
const tickets = require('../src/systems/tickets');

const GUILD = '111111111111111111', STAFF_ROLE = '222222222222222222', LOG = '333333333333333333',
  CAT = '444444444444444444', BOT = '555555555555555555', EVERYONE = GUILD;
let nextId = 900000000000000000n;
const newId = () => String(nextId++);

function makeChannel(extra = {}) {
  const ch = {
    id: newId(), sent: [], deleted: false, type: ChannelType.GuildText, ...extra,
    permissionOverwrites: { cache: new Collection(), edit: async (id, p) => { ch.permissionOverwrites.cache.set(id, { id, type: 1, ...p }); }, delete: async id => { ch.permissionOverwrites.cache.delete(id); } },
    isTextBased: () => true, get guild() { return guild; },
    send: async p => { ch.sent.push(p); return { id: newId(), ...p }; },
    delete: async () => { ch.deleted = true; guild.channels.cache.delete(ch.id); },
    messages: { fetch: async () => new Collection() }
  };
  return ch;
}
const logChannel = makeChannel({ id: LOG });
const category = makeChannel({ id: CAT, type: ChannelType.GuildCategory });
const channelsCache = new Collection([[LOG, logChannel], [CAT, category]]);
const guild = {
  id: GUILD, name: 'Test', roles: { everyone: { id: EVERYONE }, cache: new Collection([[STAFF_ROLE, {}]]), fetch: async () => null },
  members: { me: { permissions: { has: () => true } }, fetch: async id => members[id] ?? null },
  channels: {
    cache: channelsCache,
    fetch: async id => channelsCache.get(id) ?? null,
    create: async opts => { const ch = makeChannel({ name: opts.name, parentId: opts.parent, overwrites: opts.permissionOverwrites }); for (const o of opts.permissionOverwrites) ch.permissionOverwrites.cache.set(o.id, { ...o, type: o.id === STAFF_ROLE || o.id === EVERYONE ? 0 : 1 }); channelsCache.set(ch.id, ch); return ch; }
  }
};
const members = {};
function user(id, staff = false, admin = false) {
  const u = { id, username: `user${id.slice(-4)}`, tag: `user${id.slice(-4)}#0`, toString: () => `<@${id}>`, bot: false };
  members[id] = { id, permissions: { has: f => admin && f === PermissionFlagsBits.Administrator }, roles: { cache: new Collection(staff ? [[STAFF_ROLE, {}]] : []) } };
  return u;
}
function fakeInteraction(u, channel, customId) {
  const log = { replies: [] };
  const i = {
    guildId: GUILD, guild, user: u, channel, channelId: channel?.id, customId, client: { user: { id: BOT } },
    inGuild: () => true, deferred: false, replied: false, log,
    reply: async p => { i.replied = true; log.replies.push(p); },
    deferReply: async () => { i.deferred = true; },
    editReply: async p => { log.replies.push(p); },
    followUp: async p => { log.replies.push(p); },
    update: async p => { log.replies.push(p); }
  };
  return i;
}
const last = i => i.log.replies.at(-1)?.content ?? '';

test('configurazione normalizzata e senza ID inventati', () => {
  const s = tickets.getTicketSettings(GUILD);
  assert.deepStrictEqual(s.staffRoleIds, []);
  assert.strictEqual(s.categoryId, null);
  tickets.updateTicketConfig(GUILD, { categoryId: CAT, logChannelId: LOG, staffRoleIds: [STAFF_ROLE], panelChannelId: LOG });
  const t = tickets.getTicketSettings(GUILD);
  assert.deepStrictEqual(t.staffRoleIds, [STAFF_ROLE]);
  assert.strictEqual(t.transcriptChannelId, null);
});

const alice = user('100000000000000001'), staff = user('100000000000000002', true), bob = user('100000000000000003');
let ticketChannel;

test('apertura: canale privato, staff, DB, log, categoria', async () => {
  const i = fakeInteraction(alice, makeChannel(), 'auramen:ticket:open');
  await tickets.handleButton(i);
  const row = db.prepare('SELECT * FROM tickets WHERE opener_id = ?').get(alice.id);
  assert.ok(row, 'ticket registrato');
  ticketChannel = channelsCache.get(row.channel_id);
  assert.strictEqual(ticketChannel.parentId, CAT);
  const ow = ticketChannel.permissionOverwrites.cache;
  assert.ok(ow.get(EVERYONE).deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(ow.get(alice.id).allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(ow.get(STAFF_ROLE).allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(ticketChannel.sent[0].embeds[0].data.description.includes(alice.id));
  assert.ok(logChannel.sent.some(m => m.embeds[0].data.title === 'Ticket aperto'));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM ticket_logs WHERE action='open'").get().n, 1);
});

test('nessun ticket duplicato (anche con doppio click simultaneo)', async () => {
  const a = fakeInteraction(alice, makeChannel(), 'auramen:ticket:open');
  await tickets.handleButton(a);
  assert.match(last(a), /già un ticket aperto/);
  const b1 = fakeInteraction(bob, makeChannel(), 'auramen:ticket:open');
  const b2 = fakeInteraction(bob, makeChannel(), 'auramen:ticket:open');
  await Promise.all([tickets.handleButton(b1), tickets.handleButton(b2)]);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM tickets WHERE opener_id = ?').get(bob.id).n, 1);
});

test('utente non autorizzato non può chiudere, riaprire, eliminare o claimare', async () => {
  for (const action of ['close', 'claim', 'reopen', 'delete']) {
    const i = fakeInteraction(bob, ticketChannel, `auramen:ticket:${action}`);
    await tickets.handleButton(i);
    assert.match(last(i), /Solo|non risulta|non è chiuso/, action);
  }
  assert.strictEqual(db.prepare("SELECT status FROM tickets WHERE opener_id = ? AND channel_id = ?").get(alice.id, ticketChannel.id).status, 'open');
});

test('claim, chiusura con transcript, riapertura', async () => {
  const claim = fakeInteraction(staff, ticketChannel, 'auramen:ticket:claim');
  await tickets.handleButton(claim);
  assert.match(last(claim), /preso in carico/);

  // senza canale archivio il ticket resta aperto (nessuna perdita di dati)
  const noArchive = fakeInteraction(alice, ticketChannel, 'auramen:ticket:close');
  tickets.updateTicketConfig(GUILD, { logChannelId: '999999999999999999' });
  await tickets.handleButton(noArchive);
  assert.match(last(noArchive), /rimasto aperto/);
  tickets.updateTicketConfig(GUILD, { logChannelId: LOG });

  const close = fakeInteraction(alice, ticketChannel, 'auramen:ticket:close');
  await tickets.handleButton(close);
  assert.strictEqual(db.prepare('SELECT status FROM tickets WHERE channel_id = ?').get(ticketChannel.id).status, 'closed');
  assert.ok(logChannel.sent.some(m => m.files?.[0]?.name?.endsWith('transcript.html')));
  assert.ok(logChannel.sent.some(m => m.embeds[0].data.title === 'Ticket chiuso'), 'log di chiusura inviato');
  assert.ok(logChannel.sent.some(m => m.embeds[0].data.fields?.some(f => String(f.value).startsWith('Durata:'))), 'durata nel log di chiusura');
  assert.strictEqual(ticketChannel.permissionOverwrites.cache.get(alice.id).SendMessages, false);
  assert.strictEqual(ticketChannel.deleted, false, 'il canale non viene più cancellato alla chiusura');

  const reopen = fakeInteraction(staff, ticketChannel, 'auramen:ticket:reopen');
  await tickets.handleButton(reopen);
  assert.strictEqual(db.prepare('SELECT status FROM tickets WHERE channel_id = ?').get(ticketChannel.id).status, 'open');
  assert.strictEqual(ticketChannel.permissionOverwrites.cache.get(alice.id).SendMessages, true);
});

test('/ticket transcript genera il file HTML anche su ticket chiuso', async () => {
  const cmd = require('../src/commands/ticket');
  const i = fakeInteraction(staff, ticketChannel, '');
  i.options = { getSubcommand: () => 'transcript' };
  await cmd.execute(i);
  const reply = i.log.replies.at(-1);
  assert.match(reply.content, /Transcript del ticket/);
  assert.ok(reply.files?.[0]?.name?.endsWith('.html'), 'allega il file HTML');
});

test('eliminazione richiede conferma e può essere annullata', async () => {
  const ask = fakeInteraction(staff, ticketChannel, 'auramen:ticket:delete');
  await tickets.handleButton(ask);
  assert.ok(ask.log.replies[0].components.length, 'chiede conferma');
  assert.strictEqual(ticketChannel.deleted, false);
  await tickets.handleButton(fakeInteraction(staff, ticketChannel, 'auramen:ticket:delete_cancel'));
  assert.strictEqual(ticketChannel.deleted, false);
  await tickets.handleButton(fakeInteraction(bob, ticketChannel, 'auramen:ticket:delete_confirm'));
  assert.strictEqual(ticketChannel.deleted, false, 'un non-staff non può confermare');
  await tickets.handleButton(fakeInteraction(staff, ticketChannel, 'auramen:ticket:delete_confirm'));
  assert.strictEqual(ticketChannel.deleted, true);
  assert.strictEqual(db.prepare('SELECT status FROM tickets WHERE opener_id = ? ORDER BY id LIMIT 1').get(alice.id).status, 'deleted');
});

test('record orfano (canale cancellato a mano) non blocca un nuovo ticket', async () => {
  const i = fakeInteraction(alice, makeChannel(), 'auramen:ticket:open');
  await tickets.handleButton(i);
  assert.match(last(i), /Ticket creato/);
});

test('comando /ticket: struttura e controllo admin', async () => {
  const cmd = require('../src/commands/ticket');
  const names = cmd.data.toJSON().options.map(o => o.name);
  for (const n of ['setup', 'config', 'pannello', 'trasferisci', 'aggiungi', 'rimuovi', 'transcript']) assert.ok(names.includes(n), n);
  const i = fakeInteraction(bob, makeChannel(), '');
  i.options = { getSubcommand: () => 'setup' };
  i.memberPermissions = { has: () => false };
  await cmd.execute(i);
  assert.match(last(i), /amministratori/);
});
