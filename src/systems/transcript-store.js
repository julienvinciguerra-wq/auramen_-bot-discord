// Archivio dei transcript online: HTML salvato in SQLite e servito dall'API del bot.

const crypto = require('node:crypto');
const { db } = require('../database/database');

const DEFAULT_BASE_URL = 'https://auramen-bot-discord.onrender.com';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

/**
 * Salva il transcript e restituisce il link pubblico.
 * Il token è casuale: senza il link non si indovina la pagina.
 */
function saveTranscript(guildId, ticketId, buffer) {
  const token = crypto.randomBytes(16).toString('hex');
  const html = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  db.prepare('INSERT INTO transcripts (token, guild_id, ticket_id, html) VALUES (?, ?, ?, ?)')
    .run(token, guildId, ticketId ?? null, html);
  // Conservazione: i transcript più vecchi di 90 giorni vengono rimossi.
  db.prepare("DELETE FROM transcripts WHERE created_at < datetime('now', '-90 days')").run();
  return `${PUBLIC_BASE_URL}/transcripts/${token}`;
}

function getTranscript(token) {
  const value = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(value)) return null;
  return db.prepare('SELECT * FROM transcripts WHERE token = ?').get(value) || null;
}

module.exports = { saveTranscript, getTranscript, PUBLIC_BASE_URL };
