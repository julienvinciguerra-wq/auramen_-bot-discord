const { getGuildConfig, setGuildConfig } = require('../database/database');

// Gioco del conteggio: un canale dove i membri contano in ordine 1, 2, 3…
// Un numero sbagliato o due turni di fila dello stesso utente azzerano la serie.

function getCountingSettings(guildId) {
  const stored = getGuildConfig(guildId).counting || {};
  return {
    channelId: stored.channelId ? String(stored.channelId) : null,
    current: Number.isInteger(stored.current) ? stored.current : 0,
    best: Number.isInteger(stored.best) ? stored.best : 0,
    lastUserId: stored.lastUserId ? String(stored.lastUserId) : null
  };
}

function saveCountingSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config.counting = { ...getCountingSettings(guildId), ...patch };
  setGuildConfig(guildId, config);
  return getCountingSettings(guildId);
}

function startCounting(guildId, channelId) {
  return saveCountingSettings(guildId, { channelId: String(channelId), current: 0, lastUserId: null });
}

function resetCounting(guildId) {
  return saveCountingSettings(guildId, { current: 0, lastUserId: null });
}

function stopCounting(guildId) {
  return saveCountingSettings(guildId, { channelId: null, current: 0, lastUserId: null });
}

/**
 * Controlla un messaggio nel canale del conteggio. Ignora tutto ciò che non è
 * un numero: il canale resta usabile per le chiacchiere.
 */
async function handleCountingMessage(message) {
  if (!message.guild || message.author?.bot || message.system) return;

  const settings = getCountingSettings(message.guild.id);
  if (!settings.channelId || message.channelId !== settings.channelId) return;

  const text = String(message.content || '').trim();
  if (!/^\d{1,9}$/.test(text)) return;

  const value = Number(text);
  const expected = settings.current + 1;
  const sameAuthor = message.author.id === settings.lastUserId;

  if (value === expected && !sameAuthor) {
    saveCountingSettings(message.guild.id, {
      current: value,
      lastUserId: message.author.id,
      best: Math.max(settings.best, value)
    });
    await message.react('✅').catch(() => {});
    if (value % 100 === 0) {
      await message.reply(`🎉 **${value}**! Nuovo traguardo: la serie continua.`).catch(() => {});
    }
    return;
  }

  const reason = sameAuthor
    ? 'Non puoi contare due volte di fila.'
    : `Il numero giusto era **${expected}**.`;

  saveCountingSettings(message.guild.id, { current: 0, lastUserId: null });
  await message.react('❌').catch(() => {});
  await message.reply(`❌ ${reason} Il conteggio riparte da **1**.`).catch(() => {});
}

module.exports = {
  getCountingSettings,
  saveCountingSettings,
  startCounting,
  resetCounting,
  stopCounting,
  handleCountingMessage
};
