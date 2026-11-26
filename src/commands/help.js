const { SlashCommandBuilder } = require('discord.js');
const { buildHelpView, SECTIONS, ORDER } = require('../systems/help-panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Mostra il pannello di aiuto con i pulsanti per categoria.')
    .addStringOption(option => option
      .setName('sezione')
      .setDescription('Apri direttamente una categoria (facoltativo).')
      .setRequired(false)
      .addChoices(...ORDER.map(key => ({ name: SECTIONS[key].label, value: key })))),
  async execute(interaction) {
    const sezione = interaction.options.getString('sezione') || 'help';
    await interaction.reply(buildHelpView(sezione));
  }
};
