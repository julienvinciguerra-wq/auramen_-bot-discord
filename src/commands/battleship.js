const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { startBattleship } = require('../systems/games-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('battleship')
    .setDescription('Gioca a battaglie navali contro un membro del server.')
    .addUserOption(option => option
      .setName('avversario')
      .setDescription('Membro da sfidare.')
      .setRequired(true)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Le battaglie navali si giocano dentro un server.', flags: MessageFlags.Ephemeral });
    }

    const opponent = interaction.options.getUser('avversario');
    if (opponent.id === interaction.user.id) {
      return interaction.reply({ content: 'Non puoi sfidare te stesso.', flags: MessageFlags.Ephemeral });
    }
    if (opponent.bot) {
      return interaction.reply({ content: 'Scegli un membro del server, non un bot.', flags: MessageFlags.Ephemeral });
    }

    return startBattleship(interaction, opponent);
  }
};
