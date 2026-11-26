const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder
} = require('discord.js');
const {
  getWelcomeSettings, updateWelcomeSettings, buildWelcomeEmbed, DEFAULT_WELCOME, renderWelcomeText
} = require('../systems/welcome');
const { BRAND_COLOR } = require('../systems/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Messaggio di benvenuto per i nuovi membri.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Imposta canale, testo e immagine del benvenuto.')
      .addChannelOption(o => o.setName('canale').setDescription('Canale in cui inviare il benvenuto')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('titolo').setDescription('Titolo dell’embed').setMaxLength(256))
      .addStringOption(o => o.setName('messaggio').setDescription('Testo. Segnaposto: {user} {name} {server} {count}').setMaxLength(1500))
      .addStringOption(o => o.setName('immagine').setDescription('URL https di un’immagine per il banner').setMaxLength(500))
      .addStringOption(o => o.setName('colore').setDescription('Colore esadecimale, es. #A855F7').setMaxLength(7))
      .addRoleOption(o => o.setName('ping').setDescription('Ruolo da menzionare all’arrivo (opzionale)')))
    .addSubcommand(sub => sub.setName('test').setDescription('Anteprima del benvenuto (solo tu la vedi).'))
    .addSubcommand(sub => sub.setName('mostra').setDescription('Mostra la configurazione attuale.'))
    .addSubcommand(sub => sub.setName('disattiva').setDescription('Spegne il benvenuto automatico.')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa questo comando dentro un server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo gli amministratori possono gestire il benvenuto.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setupWelcome(interaction);
    if (sub === 'disattiva') {
      updateWelcomeSettings(interaction.guildId, { channelId: null });
      return interaction.reply({ content: 'Benvenuto automatico disattivato. I testi restano salvati.', ephemeral: true });
    }
    if (sub === 'mostra') return showWelcome(interaction);

    const settings = getWelcomeSettings(interaction.guildId);
    return interaction.reply({
      content: 'Anteprima del benvenuto (solo tu la vedi).',
      embeds: [buildWelcomeEmbed(interaction.member, settings)],
      ephemeral: true
    });
  }
};

async function setupWelcome(interaction) {
  const channel = interaction.options.getChannel('canale', true);
  const title = interaction.options.getString('titolo');
  const message = interaction.options.getString('messaggio');
  const image = interaction.options.getString('immagine');
  const color = interaction.options.getString('colore');
  const ping = interaction.options.getRole('ping');

  const patch = { channelId: channel.id };
  if (title) patch.title = title;
  if (message) patch.message = message.replaceAll('\\n', '\n');
  if (ping) patch.pingRoleId = ping.id;

  if (image) {
    if (!/^https:\/\/\S+$/i.test(image)) {
      return interaction.reply({ content: 'Immagine non valida: serve un URL che inizia con `https://`.', ephemeral: true });
    }
    patch.imageUrl = image;
  }

  if (color) {
    if (!/^#?[0-9a-f]{6}$/i.test(color)) {
      return interaction.reply({ content: 'Colore non valido: usa il formato `#A855F7`.', ephemeral: true });
    }
    patch.color = parseInt(color.replace('#', ''), 16);
  }

  const settings = updateWelcomeSettings(interaction.guildId, patch);
  return interaction.reply({
    content: `Benvenuto attivo in ${channel}. Prova con \`/welcome test\`.`,
    embeds: [configEmbed(interaction, settings)],
    ephemeral: true
  });
}

async function showWelcome(interaction) {
  const settings = getWelcomeSettings(interaction.guildId);
  if (!settings.channelId) {
    return interaction.reply({
      content: 'Il benvenuto non è ancora configurato: usa `/welcome setup canale:#benvenuto`.',
      ephemeral: true
    });
  }
  return interaction.reply({ embeds: [configEmbed(interaction, settings)], ephemeral: true });
}

function configEmbed(interaction, settings) {
  const preview = renderWelcomeText(settings.message, {
    user: `<@${interaction.user.id}>`,
    name: interaction.member?.displayName || interaction.user.username,
    server: interaction.guild.name,
    count: interaction.guild.memberCount ?? 0
  });

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Benvenuto')
    .addFields(
      { name: 'Canale', value: settings.channelId ? `<#${settings.channelId}>` : '*disattivato*', inline: true },
      { name: 'Ping', value: settings.pingRoleId ? `<@&${settings.pingRoleId}>` : '*nessuno*', inline: true },
      { name: 'Immagine', value: settings.imageUrl ? settings.imageUrl : '*nessuna*', inline: true },
      { name: 'Titolo', value: settings.title.slice(0, 1000) },
      { name: 'Testo', value: preview.slice(0, 1000) || DEFAULT_WELCOME.message }
    )
    .setFooter({ text: 'Segnaposto: {user} {name} {server} {count}' });
}
