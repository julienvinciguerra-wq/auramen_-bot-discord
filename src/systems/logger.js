const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../database/database');

const COLORS = {
  members: 0x57F287,
  messages: 0xFEE75C,
  channels: 0x5865F2,
  roles: 0x9B59B6,
  moderation: 0xED4245,
  voice: 0x3498DB,
  server: 0x95A5A6
};

async function sendLog(guild, category, title, description, fields = []) {
  if (!guild) return;
  const config = getGuildConfig(guild.id);
  const channelId = config.logging?.[category];
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS[category] ?? 0x5865F2)
    .setTitle(title.slice(0, 256))
    .setDescription((description || 'Nessun dettaglio disponibile.').slice(0, 4000))
    .addFields(fields.slice(0, 25).map(field => ({
      name: String(field.name).slice(0, 256),
      value: String(field.value || '—').slice(0, 1024),
      inline: Boolean(field.inline)
    })))
    .setFooter({ text: `auramen bot • ${category}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(error => {
    console.error(`Impossibile inviare log [${category}]:`, error.message);
  });
}

function short(value, max = 900) {
  if (!value) return '—';
  const text = String(value);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

module.exports = { sendLog, short };
