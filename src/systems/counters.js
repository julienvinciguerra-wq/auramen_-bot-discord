const { Events, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/database');

// Discord permette 2 rinomine di canale ogni 10 minuti per canale: sotto questa
// soglia l'API risponde 429 e il counter rischia di restare bloccato a lungo.
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 100;

const COUNTER_TYPES = {
  membri: { label: 'Membri', template: 'Membri: {count}' },
  online: { label: 'Online', template: 'Online: {count}' },
  bot: { label: 'Bot', template: 'Bot: {count}' }
};

function isCounterType(type) {
  return Object.hasOwn(COUNTER_TYPES, type);
}

/**
 * Counter configurati per il server, normalizzati.
 * Ogni voce: { channelId, template, lastValue, lastAt }.
 */
function getCounterSettings(guildId) {
  const stored = getGuildConfig(guildId).counters || {};
  const result = {};
  for (const [type, defaults] of Object.entries(COUNTER_TYPES)) {
    const entry = stored[type];
    if (!entry?.channelId) continue;
    result[type] = {
      channelId: String(entry.channelId),
      template: typeof entry.template === 'string' && entry.template.trim() ? entry.template : defaults.template,
      lastValue: Number.isInteger(entry.lastValue) ? entry.lastValue : null,
      lastAt: Number(entry.lastAt) || 0
    };
  }
  return result;
}

function saveCounterSettings(guildId, settings) {
  const config = getGuildConfig(guildId);
  config.counters = settings;
  setGuildConfig(guildId, config);
  return getCounterSettings(guildId);
}

/** Imposta (o aggiorna) il counter di un tipo. */
function setCounter(guildId, type, { channelId, template }) {
  if (!isCounterType(type)) throw new TypeError(`Tipo counter non valido: ${type}`);
  if (!channelId) throw new TypeError('Canale counter mancante.');
  const settings = getCounterSettings(guildId);
  settings[type] = {
    channelId: String(channelId),
    template: (template || COUNTER_TYPES[type].template).trim(),
    lastValue: null,
    lastAt: 0
  };
  return saveCounterSettings(guildId, settings);
}

/** Rimuove il counter di un tipo. */
function removeCounter(guildId, type) {
  const settings = getCounterSettings(guildId);
  if (!settings[type]) return false;
  delete settings[type];
  saveCounterSettings(guildId, settings);
  return true;
}

function formatCounterName(template, count) {
  const name = String(template ?? '')
    .replaceAll('{count}', String(count))
    .replace(/\s+/g, ' ')
    .trim();
  return (name || String(count)).slice(0, MAX_NAME_LENGTH);
}

/** Con la lazy loading di Discord la cache può essere parziale: la completa solo se serve. */
async function ensureMembers(guild) {
  const total = guild.memberCount ?? 0;
  if (guild.members.cache.size >= total) return;
  await guild.members.fetch({ withPresences: true }).catch(() => {});
}

/** Restituisce il valore del counter, oppure null se il dato non è disponibile. */
async function computeCount(guild, type) {
  if (type === 'membri') return guild.memberCount ?? guild.members.cache.size;

  await ensureMembers(guild);
  const members = guild.members.cache;

  if (type === 'bot') return members.filter(member => member.user?.bot).size;

  if (type === 'online') {
    // Senza presenze in cache (intent mancante o gateway non pronto) il valore sarebbe 0: meglio non toccare il canale.
    const hasPresenceData = members.some(member => member.presence !== undefined);
    if (!hasPresenceData) return null;
    return members.filter(member => member.presence && member.presence.status !== 'offline').size;
  }

  return null;
}

/**
 * Aggiorna i counter del server rispettando i limiti di Discord.
 * Ritorna { updated, skipped } per poter spiegare l'esito allo staff.
 */
async function updateCounters(guild, { force = false, now = Date.now() } = {}) {
  const settings = getCounterSettings(guild.id);
  const updated = [];
  const skipped = [];
  let changed = false;

  for (const [type, entry] of Object.entries(settings)) {
    const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || typeof channel.setName !== 'function') {
      skipped.push({ type, reason: 'canale non trovato' });
      continue;
    }

    const count = await computeCount(guild, type);
    if (count === null) {
      skipped.push({ type, reason: 'dato non disponibile' });
      continue;
    }

    const name = formatCounterName(entry.template, count);
    if (channel.name === name) {
      if (entry.lastValue !== count) {
        entry.lastValue = count;
        changed = true;
      }
      skipped.push({ type, reason: 'già aggiornato' });
      continue;
    }

    if (!force && now - entry.lastAt < MIN_INTERVAL_MS) {
      skipped.push({ type, reason: 'limite Discord (2 modifiche ogni 10 minuti)' });
      continue;
    }

    try {
      await channel.setName(name, 'Aggiornamento counter');
      entry.lastValue = count;
      entry.lastAt = now;
      changed = true;
      updated.push({ type, count, name });
    } catch (error) {
      console.error(`Aggiornamento counter ${type} fallito:`, error.message);
      skipped.push({ type, reason: 'errore Discord' });
    }
  }

  if (changed) saveCounterSettings(guild.id, settings);
  return { updated, skipped };
}

/** Controlla che il bot possa rinominare il canale scelto. */
function canManageCounterChannel(guild, channel) {
  const me = guild.members.me;
  if (!me) return 'Il bot non è nella cache del server: riprova tra qualche secondo.';
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return 'Al bot manca il permesso “Gestisci canali”, necessario per rinominare i counter.';
  }
  const perms = channel.permissionsFor(me);
  if (perms && !perms.has(PermissionFlagsBits.ManageChannels)) {
    return `Il bot non può gestire ${channel}: controlla i permessi del canale o della categoria.`;
  }
  return null;
}

/** Registra gli eventi e il timer che tengono aggiornati i counter. */
function startCounters(client) {
  const runAll = async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateCounters(guild).catch(error =>
        console.error(`Aggiornamento counter del server ${guild.id} fallito:`, error.message));
    }
  };

  client.once(Events.ClientReady, () => {
    runAll();
    const timer = setInterval(runAll, MIN_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });

  for (const event of [Events.GuildMemberAdd, Events.GuildMemberRemove]) {
    client.on(event, member => {
      updateCounters(member.guild).catch(error =>
        console.error('Aggiornamento counter fallito:', error.message));
    });
  }

  client.on(Events.GuildCreate, guild => {
    updateCounters(guild).catch(() => {});
  });
}

module.exports = {
  COUNTER_TYPES,
  MIN_INTERVAL_MS,
  isCounterType,
  getCounterSettings,
  setCounter,
  removeCounter,
  formatCounterName,
  computeCount,
  updateCounters,
  canManageCounterChannel,
  startCounters
};
