const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { startTris } = require('../systems/games-ui');

const DIFFICULTIES = [
  { name: 'Facile', value: 'facile' },
  { name: 'Media', value: 'media' },
  { name: 'Difficile', value: 'difficile' }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tris')
    .setDescription('Gioca a tris contro il bot o contro un membro del server.')
    .addUserOption(option => option
      .setName('avversario')
      .setDescription('Membro da sfidare: senza questa opzione giochi contro il bot.'))
    .addStringOption(option => option
      .setName('difficolta')
      .setDescription('Difficoltà del bot (solo in singolo).')
      .addChoices(...DIFFICULTIES)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Il tris si gioca dentro un server.', flags: MessageFlags.Ephemeral });
    }

    const opponent = interaction.options.getUser('avversario');
    const difficulty = interaction.options.getString('difficolta') || 'difficile';

    if (opponent) {
      if (opponent.id === interaction.user.id) {
        return interaction.reply({ content: 'Non puoi sfidare te stesso.', flags: MessageFlags.Ephemeral });
      }
      if (opponent.bot) {
        return interaction.reply({ content: 'Scegli un membro del server, non un bot.', flags: MessageFlags.Ephemeral });
      }
    }

    return startTris(interaction, { opponent, difficulty });
  }
};
