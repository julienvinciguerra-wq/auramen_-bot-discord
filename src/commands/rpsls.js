const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { startRpsls } = require('../systems/games-ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps-lizard-spock')
    .setDescription('Gioca a Sasso, Carta, Forbici, Lucertola, Spock contro il bot o un membro.')
    .addUserOption(option => option
      .setName('avversario')
      .setDescription('Membro da sfidare: senza questa opzione giochi contro il bot.'))
    .addBooleanOption(option => option
      .setName('aiuto')
      .setDescription('Mostra le regole prima di giocare.')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'La morra si gioca dentro un server.', flags: MessageFlags.Ephemeral });
    }

    const opponent = interaction.options.getUser('avversario');
    const rules = interaction.options.getBoolean('aiuto') ?? false;

    if (opponent) {
      if (opponent.id === interaction.user.id) {
        return interaction.reply({ content: 'Non puoi sfidare te stesso.', flags: MessageFlags.Ephemeral });
      }
      if (opponent.bot) {
        return interaction.reply({ content: 'Scegli un membro del server, non un bot.', flags: MessageFlags.Ephemeral });
      }
    }

    return startRpsls(interaction, { opponent, rules });
  }
};
