const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags
} = require('discord.js');
const {
  getCountingSettings, startCounting, resetCounting, stopCounting
} = require('../systems/counting');
const { BRAND_COLOR } = require('../systems/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('counting')
    .setDescription('Gestisce il gioco del conteggio (1, 2, 3…) nel server.')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Scegli il canale del conteggio e avvia una nuova serie (solo admin).')
      .addChannelOption(option => option
        .setName('canale')
        .setDescription('Canale dove si conta')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('stato')
      .setDescription('Mostra numero attuale, record e canale del conteggio.'))
    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('Azzera la serie e riparte da 1 (solo admin).'))
    .addSubcommand(sub => sub
      .setName('disattiva')
      .setDescription('Spegne il conteggio nel server (solo admin).')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Il conteggio si gestisce dentro un server.', flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'stato') return handleStatus(interaction);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Serve il permesso **Gestisci server** per questa operazione.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'setup') return handleSetup(interaction);
    if (sub === 'reset') return handleReset(interaction);
    return handleDisable(interaction);
  }
};

async function handleSetup(interaction) {
  const channel = interaction.options.getChannel('canale', true);
  const permissions = channel.permissionsFor(interaction.guild.members.me);

  if (permissions && (!permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.AddReactions))) {
    return interaction.reply({
      content: `Al bot servono **Invia messaggi** e **Aggiungi reazioni** in ${channel} per segnare i numeri.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const settings = startCounting(interaction.guildId, channel.id);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Conteggio attivato')
      .setDescription([
        `Canale: ${channel}`,
        'Si conta in ordine: **1**, **2**, **3**…',
        'Un numero sbagliato o due messaggi di fila dello stesso utente azzerano la serie.',
        `Record attuale: **${settings.best}**`
      ].join('\n'))
      .setTimestamp()],
    flags: MessageFlags.Ephemeral
  });
}

async function handleReset(interaction) {
  const settings = resetCounting(interaction.guildId);
  return interaction.reply({
    content: settings.channelId
      ? `Serie azzerata: il prossimo numero è **1**. Record invariato (**${settings.best}**).`
      : 'Nessun canale del conteggio configurato: usa `/counting setup`.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleDisable(interaction) {
  stopCounting(interaction.guildId);
  return interaction.reply({ content: 'Conteggio disattivato: il canale non viene più controllato.', flags: MessageFlags.Ephemeral });
}

async function handleStatus(interaction) {
  const settings = getCountingSettings(interaction.guildId);
  if (!settings.channelId) {
    return interaction.reply({
      content: 'Il conteggio non è configurato. Avvialo con `/counting setup canale:#conteggio`.',
      flags: MessageFlags.Ephemeral
    });
  }

  const last = settings.lastUserId ? `<@${settings.lastUserId}>` : 'nessuno';
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Gioco del conteggio')
      .addFields(
        { name: 'Canale', value: `<#${settings.channelId}>`, inline: true },
        { name: 'Numero attuale', value: String(settings.current), inline: true },
        { name: 'Record', value: String(settings.best), inline: true },
        { name: 'Ultimo a contare', value: last, inline: true },
        { name: 'Prossimo numero', value: String(settings.current + 1), inline: true }
      )],
    flags: MessageFlags.Ephemeral
  });
}
