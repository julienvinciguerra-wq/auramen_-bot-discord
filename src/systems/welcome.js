const { EmbedBuilder } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/database');
const { BRAND_COLOR } = require('./tickets');

const DEFAULT_WELCOME = {
  title: 'Benvenuto su {server}!',
  message: 'Ciao {user}, benvenuto nel server! Sei il membro **#{count}**.\nLeggi il regolamento e presentati in chat: buona permanenza!',
  color: BRAND_COLOR,
  imageUrl: null,
  channelId: null,
  pingRoleId: null
};

function getWelcomeSettings(guildId) {
  const stored = getGuildConfig(guildId).welcome || {};
  return {
    title: typeof stored.title === 'string' && stored.title.trim() ? stored.title : DEFAULT_WELCOME.title,
    message: typeof stored.message === 'string' && stored.message.trim() ? stored.message : DEFAULT_WELCOME.message,
    color: Number.isInteger(stored.color) ? stored.color : DEFAULT_WELCOME.color,
    imageUrl: stored.imageUrl || null,
    channelId: stored.channelId || null,
    pingRoleId: stored.pingRoleId || null
  };
}

function updateWelcomeSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config.welcome = { ...(config.welcome || {}), ...patch };
  setGuildConfig(guildId, config);
  return getWelcomeSettings(guildId);
}

/** Segnaposto: {user} {name} {server} {count}. */
function renderWelcomeText(template, data) {
  return String(template)
    .replaceAll('{user}', data.user)
    .replaceAll('{name}', data.name)
    .replaceAll('{server}', data.server)
    .replaceAll('{count}', String(data.count));
}

function buildWelcomeEmbed(member, settings) {
  const count = member.guild.memberCount ?? 0;
  const data = {
    user: `<@${member.id}>`,
    name: member.displayName || member.user.username,
    server: member.guild.name,
    count
  };

  const embed = new EmbedBuilder()
    .setColor(settings.color)
    .setTitle(renderWelcomeText(settings.title, data).slice(0, 256))
    .setDescription(renderWelcomeText(settings.message, data).slice(0, 4096))
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .setFooter({ text: `${member.guild.name} • membro #${count}` })
    .setTimestamp();

  if (settings.imageUrl) embed.setImage(settings.imageUrl);
  return embed;
}

/** Invia il benvenuto nel canale configurato, se c'è. */
async function sendWelcome(member) {
  try {
    const settings = getWelcomeSettings(member.guild.id);
    if (!settings.channelId) return;
    const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({
      content: settings.pingRoleId ? `<@&${settings.pingRoleId}>` : undefined,
      embeds: [buildWelcomeEmbed(member, settings)],
      allowedMentions: settings.pingRoleId ? { roles: [settings.pingRoleId] } : { parse: [] }
    });
  } catch (error) {
    console.error('Invio del benvenuto fallito:', error.message);
  }
}

module.exports = {
  DEFAULT_WELCOME,
  getWelcomeSettings,
  updateWelcomeSettings,
  renderWelcomeText,
  buildWelcomeEmbed,
  sendWelcome
};
