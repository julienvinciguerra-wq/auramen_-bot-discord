const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const { db, getGuildConfig } = require('../database/database');
const { sendLog } = require('../systems/logger');

const data = new SlashCommandBuilder()
  .setName('moderazione')
  .setDescription('Comandi di moderazione del server.')
  .addSubcommand(sub => sub.setName('warn').setDescription('Registra un avvertimento.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)))
  .addSubcommand(sub => sub.setName('timeout').setDescription('Applica un timeout.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addIntegerOption(o => o.setName('minuti').setDescription('Durata in minuti (1-40320)').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)))
  .addSubcommand(sub => sub.setName('untimeout').setDescription('Rimuove un timeout.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)))
  .addSubcommand(sub => sub.setName('kick').setDescription('Espelle un utente.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)))
  .addSubcommand(sub => sub.setName('ban').setDescription('Banna un utente.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)))
  .addSubcommand(sub => sub.setName('unban').setDescription('Rimuove un ban tramite ID utente.')
    .addStringOption(o => o.setName('utente_id').setDescription('ID Discord').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(false)))
  .addSubcommand(sub => sub.setName('purge').setDescription('Elimina messaggi recenti dal canale.')
    .addIntegerOption(o => o.setName('quantita').setDescription('Numero di messaggi (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)));

function checkConfiguredPermission(interaction, commandName) {
  const config = getGuildConfig(interaction.guildId);
  const rule = config.commandPermissions?.[commandName];
  if (!rule) return { ok: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator), reason: 'Comando non configurato: per sicurezza è riservato agli amministratori.' };
  const member = interaction.member;
  const hasRole = member?.roles?.cache?.has(rule.roleId);
  const rightChannel = interaction.channelId === rule.channelId;
  return { ok: Boolean(hasRole && rightChannel), reason: 'Non hai il ruolo autorizzato oppure stai usando il comando nel canale sbagliato.' };
}

function saveCase(guildId, userId, moderatorId, action, reason) {
  return db.prepare(`INSERT INTO moderation_cases (guild_id,user_id,moderator_id,action,reason) VALUES (?,?,?,?,?)`)
    .run(guildId, userId, moderatorId, action, reason || null).lastInsertRowid;
}

module.exports = {
  data,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const permission = checkConfiguredPermission(interaction, action);
    if (!permission.ok) {
      return interaction.reply({ content: permission.reason, ephemeral: true });
    }

    const reason = interaction.options.getString('motivo') || 'Nessun motivo specificato';
    const target = interaction.options.getUser('utente');
    const member = target ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;
    let caseId;

    try {
      if (action === 'warn') {
        if (!target || target.bot) return interaction.reply({ content: 'Seleziona un utente valido.', ephemeral: true });
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        await target.send(`Hai ricevuto un avvertimento nel server **${interaction.guild.name}**. Motivo: ${reason}`).catch(() => {});
        await interaction.reply({ content: `Avvertimento registrato per ${target}. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'timeout' || action === 'untimeout') {
        if (!member) return interaction.reply({ content: 'Utente non trovato nel server.', ephemeral: true });
        if (action === 'timeout') {
          const minutes = interaction.options.getInteger('minuti', true);
          await member.timeout(minutes * 60 * 1000, reason);
        } else {
          await member.timeout(null, reason);
        }
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        await interaction.reply({ content: `Operazione **${action}** completata per ${target}. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'kick' || action === 'ban') {
        if (!member) return interaction.reply({ content: 'Utente non trovato nel server.', ephemeral: true });
        if (action === 'kick') await member.kick(reason);
        else await member.ban({ reason });
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        await interaction.reply({ content: `Operazione **${action}** completata per ${target}. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'unban') {
        const userId = interaction.options.getString('utente_id', true);
        await interaction.guild.members.unban(userId, reason);
        caseId = saveCase(interaction.guildId, userId, interaction.user.id, action, reason);
        await interaction.reply({ content: `Ban rimosso per \`${userId}\`. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'purge') {
        const amount = interaction.options.getInteger('quantita', true);
        const deleted = await interaction.channel.bulkDelete(amount, true);
        caseId = saveCase(interaction.guildId, interaction.user.id, interaction.user.id, action, `Eliminati ${deleted.size} messaggi`);
        await interaction.reply({ content: `Eliminati ${deleted.size} messaggi. Caso #${caseId}.`, ephemeral: true });
      }

      if (caseId) {
        sendLog(interaction.guild, 'moderation', 'Sanzione / azione staff', `Comando: /${action}`, [
          { name: 'Utente', value: target ? `${target.tag} (\`${target.id}\`)` : 'Non applicabile' },
          { name: 'Staff', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
          { name: 'Motivo', value: reason },
          { name: 'Caso', value: `#${caseId}` }
        ]);
      }
    } catch (error) {
      console.error('Errore moderazione:', error);
      const message = 'Operazione non riuscita. Controlla i permessi del bot, il ruolo gerarchico e l’ID utente.';
      if (interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
};
