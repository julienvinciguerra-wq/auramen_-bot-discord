const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType
} = require('discord.js');
const {
  PLATFORMS, fetchRecent, sortNewest, resolveAccount, fetchTikTokOembed
} = require('../systems/social-feeds');
const {
  getFeedSettings, setFeedChannel, removeFeed, publishFeedItem, buildFeedEmbed
} = require('../systems/social-announce');

const PLATFORM_CHOICES = Object.entries(PLATFORMS).map(([value, info]) => ({ name: info.label, value }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('feed')
    .setDescription('Annuncia i nuovi video di YouTube, Twitch e TikTok.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Scegli il canale in cui annunciare una piattaforma.')
      .addStringOption(o => o.setName('piattaforma').setDescription('Piattaforma da annunciare').setRequired(true).addChoices(...PLATFORM_CHOICES))
      .addChannelOption(o => o.setName('canale').setDescription('Canale degli annunci').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('account').setDescription('Nome canale o ID (facoltativo: usa quello predefinito)').setMaxLength(120)))
    .addSubcommand(sub => sub
      .setName('link')
      .setDescription('Annuncia un video TikTok dal suo link (TikTok non ha un feed automatico).')
      .addStringOption(o => o.setName('url').setDescription('Link del video TikTok').setRequired(true).setMaxLength(500)))
    .addSubcommand(sub => sub
      .setName('test')
      .setDescription('Pubblica subito l’ultimo contenuto di una piattaforma.')
      .addStringOption(o => o.setName('piattaforma').setDescription('Piattaforma da provare').setRequired(true).addChoices(...PLATFORM_CHOICES)))
    .addSubcommand(sub => sub.setName('mostra').setDescription('Mostra le piattaforme attive e i loro canali.'))
    .addSubcommand(sub => sub
      .setName('disattiva')
      .setDescription('Spegne gli annunci di una piattaforma.')
      .addStringOption(o => o.setName('piattaforma').setDescription('Piattaforma da spegnere').setRequired(true).addChoices(...PLATFORM_CHOICES))),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa questo comando dentro un server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Solo gli amministratori possono gestire gli annunci.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setupFeed(interaction);
    if (sub === 'link') return announceLink(interaction);
    if (sub === 'test') return testFeed(interaction);
    if (sub === 'disattiva') return disableFeed(interaction);
    return showFeeds(interaction);
  }
};

async function setupFeed(interaction) {
  const platform = interaction.options.getString('piattaforma', true);
  const channel = interaction.options.getChannel('canale', true);
  const account = interaction.options.getString('account')?.trim() || null;

  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageWebhooks])) {
    return interaction.reply({
      content: `In ${channel} servono **Invia messaggi**, **Incorpora link** e **Gestisci webhook**.`,
      ephemeral: true
    });
  }

  setFeedChannel(interaction.guildId, platform, { channelId: channel.id, account });
  const info = PLATFORMS[platform];
  const who = account ? `\`${account}\`` : `\`${resolveAccount(platform, null)}\``;

  const note = platform === 'twitch' && !(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
    ? '\n⚠️ Per Twitch servono `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` nel file `.env`.'
    : platform === 'tiktok'
      ? '\nℹ️ TikTok non ha feed automatici: quando pubblichi un video lancialo con `/feed link url:<link del video>`.'
      : '';

  return interaction.reply({
    content: `Annunci **${info.label}** attivi in ${channel} per ${who}.`
      + `\nControllo automatico ogni pochi minuti; ora registro i video già online, i prossimi arrivano qui.`
      + `\nUsa \`/feed test piattaforma:${platform}\` per vedere subito com’è l’annuncio.${note}`,
    ephemeral: true
  });
}

async function announceLink(interaction) {
  const url = interaction.options.getString('url', true).trim();
  if (!/^https?:\/\//i.test(url)) {
    return interaction.reply({ content: 'Serve il link completo, tipo `https://www.tiktok.com/@auramen07/video/…`.', ephemeral: true });
  }

  const settings = getFeedSettings(interaction.guildId).tiktok;
  if (!settings?.channelId) {
    return interaction.reply({
      content: 'Imposta prima il canale con `/feed setup piattaforma:TikTok canale:#🎵｜tiktok`.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const channel = await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel) return interaction.editReply({ content: 'Il canale salvato non esiste più: rifai `/feed setup`.' });

  try {
    const item = await fetchTikTokOembed(url);
    await publishFeedItem(channel, 'tiktok', item);
    return interaction.editReply({ content: `Annuncio pubblicato in ${channel}.` });
  } catch (error) {
    return interaction.editReply({ content: `Non riesco a pubblicare l’annuncio: ${error.message || error}` });
  }
}

async function testFeed(interaction) {
  const platform = interaction.options.getString('piattaforma', true);
  const settings = getFeedSettings(interaction.guildId)[platform];

  if (!settings?.channelId) {
    return interaction.reply({ content: `Attiva prima la piattaforma con \`/feed setup piattaforma:${platform} canale:…\`.`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const channel = await interaction.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel) {
    return interaction.editReply({ content: 'Il canale salvato non esiste più: rifai `/feed setup`.' });
  }

  try {
    const items = sortNewest(await fetchRecent(platform, settings.account));
    if (!items.length) return interaction.editReply({ content: 'Nessun contenuto trovato su questa piattaforma.' });
    await publishFeedItem(channel, platform, items[0]);
    return interaction.editReply({ content: `Annuncio di prova inviato in ${channel}: ${items[0].url}` });
  } catch (error) {
    return interaction.editReply({ content: `Non riesco a leggere la piattaforma: ${error.message || error}` });
  }
}

async function disableFeed(interaction) {
  const platform = interaction.options.getString('piattaforma', true);
  const label = PLATFORMS[platform].label;
  const removed = removeFeed(interaction.guildId, platform);
  return interaction.reply({
    content: removed ? `Annunci **${label}** disattivati.` : `Gli annunci **${label}** non erano attivi.`,
    ephemeral: true
  });
}

async function showFeeds(interaction) {
  const settings = getFeedSettings(interaction.guildId);
  const active = Object.keys(settings);

  if (!active.length) {
    return interaction.reply({
      content: 'Nessuna piattaforma attiva. Attivale con `/feed setup piattaforma:YouTube canale:#▶️｜youtube`.',
      ephemeral: true
    });
  }

  const lines = active.map(platform => {
    const entry = settings[platform];
    const who = entry.account || resolveAccount(platform, null);
    return `**${PLATFORMS[platform].label}** (<#${entry.channelId}>) — \`${who}\``
      + `${entry.seen ? '' : ' — in attesa del primo controllo'}`;
  });

  const preview = buildFeedEmbed(active[0], {
    title: 'Esempio di annuncio',
    url: PLATFORMS[active[0]].label === 'Twitch' ? 'https://www.twitch.tv' : 'https://www.tiktok.com',
    thumbnail: null,
    publishedAt: new Date().toISOString(),
    live: false
  });

  return interaction.reply({
    content: `Piattaforme attive:\n${lines.join('\n')}`,
    embeds: [preview],
    ephemeral: true
  });
}
