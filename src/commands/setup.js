const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/database');
const { getTicketSettings } = require('../systems/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configura auramen bot direttamente da Discord.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('logs')
      .setDescription('Imposta il canale di una categoria di log.')
      .addStringOption(option => option
        .setName('categoria')
        .setDescription('Categoria dei log')
        .setRequired(true)
        .addChoices(
          { name: 'Membri', value: 'members' },
          { name: 'Messaggi', value: 'messages' },
          { name: 'Canali', value: 'channels' },
          { name: 'Ruoli', value: 'roles' },
          { name: 'Moderazione', value: 'moderation' },
          { name: 'Ticket', value: 'ticket' },
          { name: 'Vocali', value: 'voice' },
          { name: 'Server', value: 'server' }
        ))
      .addChannelOption(option => option
        .setName('canale')
        .setDescription('Canale testuale in cui inviare i log')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('tickets')
      .setDescription('Imposta i canali del sistema ticket.')
      .addChannelOption(option => option
        .setName('pannello')
        .setDescription('Canale in cui pubblicare il pannello ticket')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addChannelOption(option => option
        .setName('transcript')
        .setDescription('Canale privato per gli archivi dei ticket')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addRoleOption(option => option
        .setName('staff')
        .setDescription('Ruolo autorizzato a gestire i ticket')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('permessi')
      .setDescription('Imposta ruolo e canale autorizzati per un comando staff.')
      .addStringOption(option => option
        .setName('comando')
        .setDescription('Comando da configurare')
        .setRequired(true)
        .addChoices(
          { name: 'warn', value: 'warn' },
          { name: 'timeout', value: 'timeout' },
          { name: 'untimeout', value: 'untimeout' },
          { name: 'kick', value: 'kick' },
          { name: 'ban', value: 'ban' },
          { name: 'unban', value: 'unban' },
          { name: 'purge', value: 'purge' }
        ))
      .addRoleOption(option => option
        .setName('ruolo')
        .setDescription('Ruolo autorizzato')
        .setRequired(true))
      .addChannelOption(option => option
        .setName('canale')
        .setDescription('Canale in cui usare il comando')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('mostra')
      .setDescription('Mostra la configurazione salvata.')),

  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'logs') {
      const category = interaction.options.getString('categoria', true);
      const channel = interaction.options.getChannel('canale', true);
      config.logging ??= {};
      config.logging[category] = channel.id;
      // Il canale log dei ticket è letto anche dal sistema ticket (/ticket config).
      if (category === 'ticket') {
        config.tickets = { ...(config.tickets || {}), logChannelId: channel.id };
      }
      setGuildConfig(interaction.guildId, config);
      return interaction.reply({
        content: `Categoria **${category}** configurata su ${channel}.`,
        ephemeral: true
      });
    }

    if (subcommand === 'permessi') {
      const command = interaction.options.getString('comando', true);
      const role = interaction.options.getRole('ruolo', true);
      const channel = interaction.options.getChannel('canale', true);
      config.commandPermissions ??= {};
      config.commandPermissions[command] = { roleId: role.id, channelId: channel.id };
      setGuildConfig(interaction.guildId, config);
      return interaction.reply({
        content: `Permessi per **/${command}** salvati: ruolo ${role}, canale ${channel}.`,
        ephemeral: true
      });
    }

    if (subcommand === 'tickets') {
      const panel = interaction.options.getChannel('pannello', true);
      const transcript = interaction.options.getChannel('transcript', true);
      const staff = interaction.options.getRole('staff', true);
      config.tickets = {
        ...config.tickets,
        panelChannelId: panel.id,
        transcriptChannelId: transcript.id,
        staffRoleId: staff.id,
        staffRoleIds: [staff.id]
      };
      setGuildConfig(interaction.guildId, config);
      return interaction.reply({
        content: `Configurazione ticket salvata. Pannello: ${panel}; transcript: ${transcript}; staff: ${staff}.`,
        ephemeral: true
      });
    }

    const logging = Object.entries(config.logging || {})
      .map(([key, id]) => `• **${key}:** <#${id}>`)
      .join('\n') || 'Non configurati';
    const t = getTicketSettings(interaction.guildId);
    const tickets = (t.panelChannelId || t.staffRoleIds.length || t.transcriptChannelId)
      ? [
          `Pannello: ${t.panelChannelId ? `<#${t.panelChannelId}>` : '—'}`,
          `Transcript: ${t.transcriptChannelId ? `<#${t.transcriptChannelId}>` : '—'}`,
          `Log: ${t.logChannelId ? `<#${t.logChannelId}>` : '—'}`,
          `Categoria: ${t.categoryId ? `<#${t.categoryId}>` : '—'}`,
          `Staff: ${t.staffRoleIds.length ? t.staffRoleIds.map(id => `<@&${id}>`).join(' ') : '—'}`
        ].join('\n')
      : 'Non configurato';

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Configurazione auramen bot')
      .addFields(
        { name: 'Logging', value: logging },
        { name: 'Ticket', value: tickets }
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
