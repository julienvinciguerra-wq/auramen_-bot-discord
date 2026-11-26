const { SlashCommandBuilder } = require('discord.js');

const LINES = [
  '🌱 Tocca l’erba!',
  '🌿 Tocca l’erba: fuori c’è un mondo intero.',
  '🍃 Tocca l’erba e respira: il server può aspettare.'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('toccalerba')
    .setDescription('Tocca l’erba!'),

  async execute(interaction) {
    const line = LINES[Math.floor(Math.random() * LINES.length)];
    await interaction.reply(line);
  }
};
