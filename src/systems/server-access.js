/**
 * Permessi di accesso del server auramen.
 *
 * Regole:
 *  - i canali LOG e la categoria TICKET si vedono solo con il ruolo giusto
 *    (Accesso Logs / Accesso Ticket); Admin e Moderatore li vedono sempre;
 *  - le vocali private (🔐) le vedono tutti, anche chi è dentro, ma per
 *    entrare serve il ruolo Accesso Vocali.
 *
 * Il modulo è idempotente: si può lanciare quante volte si vuole.
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { ROLES, CATEGORIES, ACCESS } = require('./server-structure');

const REASON = 'Permessi auramen';
const MANAGER_ROLES = ['Admin', 'Moderatore'];
const LOG_CATEGORY_PART = 'LOG';
const TICKET_CATEGORY_PART = 'TICKET';
const VOICE_CATEGORY_PART = 'VOCALI';

const ACCESS_ROLE_NAMES = Object.values(ACCESS);

/** "🔐｜privata-1" → "privata-1" */
function plainName(name) {
  const value = String(name || '');
  const index = value.lastIndexOf('｜');
  return index === -1 ? value : value.slice(index + 1);
}

function restrictedVoices() {
  return CATEGORIES.flatMap(category => category.channels).filter(channel => channel.restricted);
}

function roleByName(roles, name) {
  const wanted = String(name || '').toLowerCase();
  return roles.find(role => role.name.toLowerCase() === wanted) || null;
}

async function ensureAccessRoles(guild, report) {
  for (const def of ROLES) {
    if (!ACCESS_ROLE_NAMES.includes(def.name)) continue;
    if (roleByName([...guild.roles.cache.values()], def.name)) continue;
    const payload = { name: def.name, reason: REASON };
    if (def.color) payload.colors = { primaryColor: def.color };
    const role = await guild.roles.create(payload);
    report.created.push(`ruolo ${role.name}`);
  }
}

/** Applica le stesse overwrite a un canale (o categoria), senza toccare altro. */
async function setAccess(channel, entries) {
  for (const entry of entries) {
    const payload = {};
    for (const flag of entry.allow || []) payload[flag] = true;
    for (const flag of entry.deny || []) payload[flag] = false;
    await channel.permissionOverwrites.edit(entry.id, payload, { reason: REASON });
  }
}

/** Crea le vocali private richieste dalla struttura se non ci sono ancora. */
async function ensureRestrictedVoices(guild, voiceCategory, report) {
  const created = [];
  for (const def of restrictedVoices()) {
    const wanted = plainName(def.name).toLowerCase();
    const existing = [...guild.channels.cache.values()].find(
      channel => channel.type === ChannelType.GuildVoice && plainName(channel.name).toLowerCase() === wanted
    );
    if (existing) {
      created.push(existing);
      continue;
    }
    const channel = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildVoice,
      ...(voiceCategory ? { parent: voiceCategory.id } : {}),
      reason: REASON
    });
    report.created.push(`canale vocale ${channel.name}`);
    created.push(channel);
  }
  return created;
}

/**
 * Applica tutti i permessi di accesso.
 * Restituisce { created, updated, errors } per il log da terminale.
 */
async function applyAccessPermissions(guild) {
  const report = { created: [], updated: [], errors: [] };

  await guild.roles.fetch();
  await ensureAccessRoles(guild, report);
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = [...guild.roles.cache.values()];
  const everyone = guild.roles.everyone;
  const logsRole = roleByName(roles, ACCESS.logs);
  const ticketRole = roleByName(roles, ACCESS.ticket);
  const voiceRole = roleByName(roles, ACCESS.voice);
  const managers = MANAGER_ROLES.map(name => roleByName(roles, name)).filter(Boolean);
  const staff = roleByName(roles, 'Staff');

  const channels = [...guild.channels.cache.values()];
  const categories = channels.filter(channel => channel.type === ChannelType.GuildCategory);

  const view = PermissionFlagsBits.ViewChannel;
  const history = PermissionFlagsBits.ReadMessageHistory;
  const send = PermissionFlagsBits.SendMessages;
  const attach = PermissionFlagsBits.AttachFiles;
  const connect = PermissionFlagsBits.Connect;
  const speak = PermissionFlagsBits.Speak;

  // --- LOG: nascosti a tutti, visibili a chi ha il ruolo ---
  const logCategory = categories.find(category => category.name.includes(LOG_CATEGORY_PART));
  if (!logCategory) {
    report.errors.push('categoria LOG non trovata: canali log non nascosti');
  } else if (!logsRole) {
    report.errors.push(`ruolo ${ACCESS.logs} non disponibile: canali log non aggiornati`);
  } else {
    const logEntries = [
      { id: everyone.id, deny: [view] },
      { id: logsRole.id, allow: [view, history] },
      ...managers.map(role => ({ id: role.id, allow: [view, history] }))
    ];
    try {
      await setAccess(logCategory, logEntries);
      const logChannels = channels.filter(channel => channel.parentId === logCategory.id);
      for (const channel of logChannels) await setAccess(channel, logEntries);
      report.updated.push(`canali log (${logChannels.length}) → solo @${ACCESS.logs}, Admin e Moderatore`);
    } catch (error) {
      report.errors.push(`canali log: ${error.message}`);
    }
  }

  // --- TICKET: categoria visibile solo a chi gestisce i ticket ---
  const ticketCategory = categories.find(category => category.name.includes(TICKET_CATEGORY_PART));
  if (!ticketCategory) {
    report.errors.push('categoria TICKET non trovata: categoria ticket non nascosta');
  } else if (!ticketRole) {
    report.errors.push(`ruolo ${ACCESS.ticket} non disponibile: categoria ticket non aggiornata`);
  } else {
    const ticketEntries = [
      { id: everyone.id, deny: [view] },
      { id: ticketRole.id, allow: [view, history, send, attach] },
      ...managers.map(role => ({ id: role.id, allow: [view, history, send, attach] })),
      ...(staff ? [{ id: staff.id, allow: [view, history, send, attach] }] : [])
    ];
    try {
      await setAccess(ticketCategory, ticketEntries);
      report.updated.push(`categoria ticket → solo @${ACCESS.ticket}, Staff, Admin e Moderatore`);
    } catch (error) {
      report.errors.push(`categoria ticket: ${error.message}`);
    }
  }

  // --- Vocali private: tutti le vedono, solo il ruolo entra ---
  const voiceCategory = categories.find(category => category.name.includes(VOICE_CATEGORY_PART));
  try {
    const voices = await ensureRestrictedVoices(guild, voiceCategory, report);
    if (!voiceRole) {
      report.errors.push(`ruolo ${ACCESS.voice} non disponibile: vocali private non aggiornate`);
    } else {
      const voiceEntries = [
        { id: everyone.id, allow: [view], deny: [connect] },
        { id: voiceRole.id, allow: [view, connect, speak] },
        ...managers.map(role => ({ id: role.id, allow: [view, connect, speak] })),
        ...(staff ? [{ id: staff.id, allow: [view, connect, speak] }] : [])
      ];
      for (const channel of voices) await setAccess(channel, voiceEntries);
      report.updated.push(`vocali private (${voices.length}) → visibili a tutti, entrano solo @${ACCESS.voice}, Staff, Admin e Moderatore`);
    }
  } catch (error) {
    report.errors.push(`vocali private: ${error.message}`);
  }

  return report;
}

module.exports = {
  applyAccessPermissions,
  ensureAccessRoles,
  restrictedVoices,
  plainName,
  ACCESS
};
