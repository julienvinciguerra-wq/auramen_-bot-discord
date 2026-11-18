const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Controlla se auramen bot è online.'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('auramen bot')
      .setDescription('Sono online e pronto.')
      .addFields(
        { name: 'Latenza API', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
        { name: 'Stato', value: 'Operativo', inline: true }
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
