const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pong')
    .setDescription('Risponde con ping e mostra la latenza.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Ping!')
      .addField('Latenza API', `${Math.round(interaction.client.ws.ping)} ms`, true);
    await interaction.reply({ embeds: [embed] });
  }
};
