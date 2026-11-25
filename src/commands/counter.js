const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder
} = require('discord.js');
const {
  COUNTER_TYPES, MIN_INTERVAL_MS, getCounterSettings, setCounter, removeCounter,
  updateCounters, canManageCounterChannel
} = require('../systems/counters');
const { BRAND_COLOR } = require('../systems/tickets');

const typeChoices = Object.entries(COUNTER_TYPES).map(([value, info]) => ({ name: info.label, value }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Gestisce i canali counter del server (membri, online, bot).')
    .addSubcommand(sub => sub.setName('setup').setDescription('Assegna un canale a un counter (solo admin).')
      .addStringOption(o => o.setName('tipo').setDescription('Quale counter aggiornare').setRequired(true).addChoices(...typeChoices))
      .addChannelOption(o => o.setName('canale').setDescription('Canale da rinominare con il conteggio')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('formato').setDescription('Nome del canale; {count} viene sostituito dal numero. Es. “Membri: {count}”').setMaxLength(100)))
    .addSubcommand(sub => sub.setName('aggiorna').setDescription('Forza l’aggiornamento di tutti i counter (solo admin).'))
    .addSubcommand(sub => sub.setName('mostra').setDescription('Mostra i counter configurati (solo admin).'))
    .addSubcommand(sub => sub.setName('rimuovi').setDescription('Smetti di aggiornare un counter (solo admin).')
      .addStringOption(o => o.setName('tipo').setDescription('Counter da rimuovere').setRequired(true).addChoices(...typeChoices))),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa questo comando dentro un server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo gli amministratori possono gestire i counter.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') return handleSetup(interaction);
    if (sub === 'rimuovi') return handleRemove(interaction);
    if (sub === 'aggiorna') return handleRefresh(interaction);
    return handleShow(interaction);
  }
};

async function handleSetup(interaction) {
  const type = interaction.options.getString('tipo', true);
  const channel = interaction.options.getChannel('canale', true);
  const format = interaction.options.getString('formato');

  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: 'Scegli un canale vocale o testuale: le categorie non possono essere rinominate.', ephemeral: true });
  }

  const problem = canManageCounterChannel(interaction.guild, channel);
  if (problem) return interaction.reply({ content: problem, ephemeral: true });

  setCounter(interaction.guildId, type, { channelId: channel.id, template: format });
  const result = await updateCounters(interaction.guild).catch(error => {
    console.error('Aggiornamento counter fallito:', error.message);
    return null;
  });

  const updated = result?.updated.find(item => item.type === type);
  const skipped = result?.skipped.find(item => item.type === type);
  const notes = [];
  if (updated) notes.push(`Canale rinominato in **${updated.name}**.`);
  else if (skipped) notes.push(`Counter salvato, ma il canale non è stato rinominato ora: ${skipped.reason}.`);
  notes.push(`Discord permette al massimo 2 rinomine ogni ${MIN_INTERVAL_MS / 60000} minuti per canale, quindi il nome si aggiorna con calma: per i counter è consigliato un canale **vocale**, che non intasa le notifiche.`);

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Counter configurato')
      .setDescription(notes.join('\n\n'))
      .addFields(
        { name: 'Tipo', value: COUNTER_TYPES[type].label, inline: true },
        { name: 'Canale', value: `${channel}`, inline: true },
        { name: 'Formato', value: format || COUNTER_TYPES[type].template, inline: true }
      )
      .setTimestamp()],
    ephemeral: true
  });
}

async function handleRemove(interaction) {
  const type = interaction.options.getString('tipo', true);
  const removed = removeCounter(interaction.guildId, type);
  return interaction.reply({
    content: removed
      ? `Il counter **${COUNTER_TYPES[type].label}** non viene più aggiornato. Il canale resta com’è.`
      : `Non c’era nessun counter **${COUNTER_TYPES[type].label}** configurato.`,
    ephemeral: true
  });
}

async function handleRefresh(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const settings = getCounterSettings(interaction.guildId);
  if (!Object.keys(settings).length) {
    return interaction.editReply({ content: 'Nessun counter configurato: usa `/counter setup` per crearne uno.' });
  }

  const result = await updateCounters(interaction.guild, { force: true });
  const lines = [
    ...result.updated.map(item => `✅ **${COUNTER_TYPES[item.type].label}** → ${item.name}`),
    ...result.skipped.map(item => `• **${COUNTER_TYPES[item.type].label}**: ${item.reason}`)
  ];
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Counter aggiornati')
      .setDescription(lines.join('\n').slice(0, 4000))
      .setTimestamp()]
  });
}

async function handleShow(interaction) {
  const settings = getCounterSettings(interaction.guildId);
  const entries = Object.entries(settings);
  if (!entries.length) {
    return interaction.reply({
      content: 'Nessun counter configurato.\nEsempio: `/counter setup tipo:Membri canale:#membri formato:Membri: {count}`',
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Counter configurati')
    .setFooter({ text: `Aggiornamento massimo ogni ${MIN_INTERVAL_MS / 60000} minuti per canale` })
    .setTimestamp();

  for (const [type, entry] of entries) {
    const lines = [
      `Canale: <#${entry.channelId}>`,
      `Formato: \`${entry.template}\``,
      `Ultimo valore: ${entry.lastValue ?? 'mai aggiornato'}`
    ];
    if (entry.lastAt) lines.push(`Ultima rinomina: <t:${Math.floor(entry.lastAt / 1000)}:R>`);
    embed.addFields({ name: COUNTER_TYPES[type].label, value: lines.join('\n'), inline: true });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
