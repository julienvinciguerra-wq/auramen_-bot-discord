/**
 * Annunci dei nuovi contenuti: un webhook per piattaforma (nome "YouTube",
 * "Twitch", "Kick", "TikTok") pubblica la scheda del video appena uscito nel
 * canale scelto. Il webhook compare come APP, quindi nessuno stato online/offline.
 *
 * Stato salvato in `config.feeds`: canale, account, credenziali (Twitch e Kick)
 * e ultimi ID visti, così un riavvio non ripubblica gli stessi video.
 */

const { EmbedBuilder } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/database');
const {
  PLATFORMS, isPlatform, sortNewest, fetchRecent, hasCredentials, resolveCredentials
} = require('./social-feeds');

const FOOTER = 'AURAMEN • Nuovo contenuto';
const SEEN_LIMIT = 30;
const DEFAULT_INTERVAL_MINUTES = 10;
const FIRST_RUN_DELAY_MS = 20000;

// Piattaforme senza feed pubblico: si annunciano dal link con `/feed link`.
const MANUAL_PLATFORMS = new Set(['tiktok']);

const warned = new Set();

function normalize(entry, platform) {
  const info = PLATFORMS[platform];
  return {
    channelId: entry?.channelId ? String(entry.channelId) : null,
    webhookId: entry?.webhookId ? String(entry.webhookId) : null,
    account: entry?.account || null,
    clientId: entry?.clientId || null,
    clientSecret: entry?.clientSecret || null,
    hint: info.channelHint,
    seen: Array.isArray(entry?.seen) ? entry.seen.map(String).slice(0, SEEN_LIMIT) : null
  };
}

/** Piattaforme configurate per il server: { youtube: {...}, kick: {...} }. */
function getFeedSettings(guildId) {
  const stored = getGuildConfig(guildId).feeds || {};
  const settings = {};
  for (const platform of Object.keys(PLATFORMS)) {
    if (!stored[platform]) continue;
    settings[platform] = normalize(stored[platform], platform);
  }
  return settings;
}

function saveFeedSettings(guildId, settings) {
  const config = getGuildConfig(guildId);
  config.feeds = settings;
  setGuildConfig(guildId, config);
  return getFeedSettings(guildId);
}

/** Attiva gli annunci di una piattaforma in un canale (credenziali facoltative). */
function setFeedChannel(guildId, platform, { channelId, account, clientId, clientSecret } = {}) {
  if (!isPlatform(platform)) throw new TypeError(`Piattaforma non valida: ${platform}`);
  if (!channelId) throw new TypeError('Canale mancante.');
  const settings = getFeedSettings(guildId);
  const current = normalize(settings[platform], platform);
  settings[platform] = {
    ...current,
    channelId: String(channelId),
    account: account || current.account || null,
    clientId: clientId || current.clientId || null,
    clientSecret: clientSecret || current.clientSecret || null
  };
  return saveFeedSettings(guildId, settings);
}

/** Spegne gli annunci di una piattaforma (i video già visti restano). */
function removeFeed(guildId, platform) {
  const settings = getFeedSettings(guildId);
  if (!settings[platform]) return false;
  delete settings[platform];
  saveFeedSettings(guildId, settings);
  return true;
}

function markSeen(guildId, platform, ids) {
  const settings = getFeedSettings(guildId);
  if (!settings[platform]) return;
  const previous = settings[platform].seen || [];
  settings[platform].seen = [...new Set([...ids, ...previous])].slice(0, SEEN_LIMIT);
  saveFeedSettings(guildId, settings);
}

function rememberWebhook(guildId, platform, webhookId) {
  const settings = getFeedSettings(guildId);
  if (!settings[platform]) return;
  settings[platform].webhookId = String(webhookId);
  saveFeedSettings(guildId, settings);
}

/** Scheda del contenuto: nome piattaforma come autore, video sotto. */
function buildFeedEmbed(platform, item) {
  const info = PLATFORMS[platform];
  const embed = new EmbedBuilder()
    .setColor(info.color)
    .setAuthor({ name: info.label })
    .setTitle(String(item.title || 'Nuovo contenuto').slice(0, 256))
    .setURL(item.url)
    .setDescription(item.live ? '🔴 Sono live adesso: vieni a salutare!' : 'Guarda il video appena uscito.')
    .setFooter({ text: FOOTER });

  if (item.thumbnail) embed.setImage(item.thumbnail);
  const date = item.publishedAt ? new Date(item.publishedAt) : new Date();
  if (!Number.isNaN(date.getTime())) embed.setTimestamp(date);
  return embed;
}

/** Webhook della piattaforma nel canale, creato la prima volta. */
async function ensureFeedWebhook(channel, platform) {
  const name = PLATFORMS[platform].label;
  const hooks = await channel.fetchWebhooks();
  const existing = hooks.find(hook => hook.name === name && hook.channelId === channel.id);
  if (existing) return existing;
  return channel.createWebhook({
    name,
    avatar: channel.client.user.displayAvatarURL({ extension: 'png', size: 256 }),
    reason: `Annunci ${name} auramen`
  });
}

/** Invia la scheda con il webhook della piattaforma. */
async function publishFeedItem(channel, platform, item) {
  const webhook = await ensureFeedWebhook(channel, platform);
  const message = await webhook.send({
    username: PLATFORMS[platform].label,
    avatarURL: channel.client.user.displayAvatarURL({ extension: 'png', size: 256 }),
    embeds: [buildFeedEmbed(platform, item)],
    allowedMentions: { parse: [] },
    wait: true
  });
  return { webhook, message };
}

/**
 * Controlla una piattaforma: pubblica i contenuti mai visti.
 * Alla prima esecuzione registra solo gli ID esistenti (niente raffica di
 * video vecchi); con `force` pubblica subito il più recente.
 */
async function checkPlatform(guild, platform, { force = false } = {}) {
  if (MANUAL_PLATFORMS.has(platform)) return { platform, posted: 0, skipped: 'annuncio manuale' };

  const settings = getFeedSettings(guild.id)[platform];
  if (!settings?.channelId) return { platform, posted: 0, skipped: 'non configurata' };

  if (!hasCredentials(platform, settings)) {
    if (!warned.has(platform)) {
      warned.add(platform);
      const info = PLATFORMS[platform];
      console.warn(`[Feed ${platform}] Servono Client ID e Secret: /feed setup piattaforma:${info.label} canale:… client_id:… client_secret:…`);
    }
    return { platform, posted: 0, skipped: 'credenziali mancanti' };
  }

  const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel) return { platform, posted: 0, skipped: 'canale non trovato' };

  const items = sortNewest(await fetchRecent(platform, settings.account, settings));
  if (!items.length) return { platform, posted: 0, skipped: 'nessun contenuto' };

  const baseline = !Array.isArray(settings.seen);
  const toPost = baseline
    ? (force ? items.slice(0, 1) : [])
    : items.filter(item => !settings.seen.includes(item.id));

  let posted = 0;
  for (const item of [...toPost].reverse()) {
    const { webhook } = await publishFeedItem(channel, platform, item);
    if (settings.webhookId !== webhook.id) rememberWebhook(guild.id, platform, webhook.id);
    posted += 1;
  }

  markSeen(guild.id, platform, items.map(item => item.id));
  return { platform, posted, baseline, skipped: null };
}

/** Controlla tutte le piattaforme configurate nel server. */
async function checkGuild(guild, { force = false } = {}) {
  const settings = getFeedSettings(guild.id);
  const platforms = Object.keys(settings)
    .filter(platform => settings[platform].channelId && !MANUAL_PLATFORMS.has(platform));
  const results = [];
  for (const platform of platforms) {
    try {
      results.push(await checkPlatform(guild, platform, { force }));
    } catch (error) {
      console.error(`[Feed ${platform}] ${error.message || error}`);
      results.push({ platform, posted: 0, error: error.message || String(error) });
    }
  }
  return results;
}

/** Loop di controllo: parte col bot e ripete ogni N minuti. */
function startSocialFeeds(client, { intervalMinutes = Number(process.env.FEED_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES } = {}) {
  const interval = Math.max(2, intervalMinutes) * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (!Object.keys(getFeedSettings(guild.id)).length) continue;
        await checkGuild(guild);
      }
    } catch (error) {
      console.error('[Feed] Errore nel controllo:', error.message || error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, interval);
  timer.unref?.();
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  getFeedSettings,
  setFeedChannel,
  removeFeed,
  buildFeedEmbed,
  ensureFeedWebhook,
  publishFeedItem,
  checkPlatform,
  checkGuild,
  startSocialFeeds
};
