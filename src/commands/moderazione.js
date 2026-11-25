const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const { db, getGuildConfig } = require('../database/database');
const { sendLog } = require('../systems/logger');
const {
  moderationBlock, hasModerationAccess, listCases, countCases, getCase, deleteCase,
  notifyMember, formatCaseLines
} = require('../systems/moderation');

const ACTION_LABELS = {
  warn: 'Avvertimento',
  timeout: 'Timeout',
  untimeout: 'Rimozione timeout',
  kick: 'Espulsione',
  ban: 'Ban',
  unban: 'Rimozione ban',
  purge: 'Purge messaggi'
};

const data = new SlashCommandBuilder()
  .setName('moderazione')
  .setDescription('Comandi di moderazione del server.')
  .addSubcommand(sub => sub.setName('warn').setDescription('Registra un avvertimento.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true)))
  .addSubcommand(sub => sub.setName('storico').setDescription('Mostra gli ultimi provvedimenti di un utente.')
    .addUserOption(o => o.setName('utente').setDescription('Utente').setRequired(true))
    .addIntegerOption(o => o.setName('quantita').setDescription('Quanti casi mostrare (1-25)').setMinValue(1).setMaxValue(25)))
  .addSubcommand(sub => sub.setName('annulla').setDescription('Elimina un caso registrato per errore (solo admin).')
    .addIntegerOption(o => o.setName('caso').setDescription('Numero del caso, es. 12').setMinValue(1).setRequired(true)))
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
    .addStringOption(o => o.setName('motivo').setDescription('Motivo').setRequired(true))
    .addIntegerOption(o => o.setName('elimina_messaggi_giorni').setDescription('Elimina i messaggi recenti dell’utente (0-7 giorni)').setMinValue(0).setMaxValue(7)))
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

function logAction(interaction, { target, action, reason, caseId, extra = [] }) {
  sendLog(interaction.guild, 'moderation', 'Sanzione / azione staff', `Comando: /moderazione ${action}`, [
    { name: 'Utente', value: target ? `${target.tag} (\`${target.id}\`)` : 'Non applicabile' },
    { name: 'Staff', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
    { name: 'Motivo', value: reason || '—' },
    { name: 'Caso', value: caseId ? `#${caseId}` : '—' },
    ...extra
  ]);
}

module.exports = {
  data,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const config = getGuildConfig(interaction.guildId);

    if (action === 'storico') {
      if (!hasModerationAccess(interaction, config)) {
        return interaction.reply({ content: 'Solo lo staff autorizzato può consultare lo storico dei provvedimenti.', ephemeral: true });
      }
      return showHistory(interaction);
    }

    if (action === 'annulla') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Solo gli amministratori possono annullare un caso.', ephemeral: true });
      }
      return voidCase(interaction);
    }

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
        if (!target || target.bot) return interaction.reply({ content: 'Seleziona un utente valido (non un bot).', ephemeral: true });
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        const notified = await notifyMember(target, interaction.guild, ACTION_LABELS.warn, reason);
        const warns = countCases(interaction.guildId, target.id, 'warn');
        await interaction.reply({
          content: `Avvertimento registrato per ${target}. Caso #${caseId} (totale warn: ${warns}).${notified ? '' : '\nL’utente ha i DM chiusi: non ha ricevuto l’avviso.'}`,
          ephemeral: true
        });
      } else if (action === 'timeout' || action === 'untimeout') {
        const block = moderationBlock(interaction, member, action);
        if (block) return interaction.reply({ content: block, ephemeral: true });
        if (action === 'timeout') {
          const minutes = interaction.options.getInteger('minuti', true);
          await member.timeout(minutes * 60 * 1000, reason);
          await notifyMember(target, interaction.guild, `${ACTION_LABELS.timeout} di ${minutes} minuti`, reason);
        } else {
          await member.timeout(null, reason);
          await notifyMember(target, interaction.guild, ACTION_LABELS.untimeout, reason);
        }
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        await interaction.reply({ content: `Operazione **${action}** completata per ${target}. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'kick' || action === 'ban') {
        const block = moderationBlock(interaction, member, action);
        if (block) return interaction.reply({ content: block, ephemeral: true });
        if (action === 'kick') {
          await notifyMember(target, interaction.guild, ACTION_LABELS.kick, reason);
          await member.kick(reason);
        } else {
          const days = interaction.options.getInteger('elimina_messaggi_giorni') ?? 0;
          await notifyMember(target, interaction.guild, ACTION_LABELS.ban, reason);
          await member.ban({ reason, deleteMessageSeconds: days * 24 * 60 * 60 });
        }
        caseId = saveCase(interaction.guildId, target.id, interaction.user.id, action, reason);
        await interaction.reply({ content: `Operazione **${action}** completata per ${target}. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'unban') {
        const userId = interaction.options.getString('utente_id', true).trim();
        if (!/^\d{15,25}$/.test(userId)) {
          return interaction.reply({ content: 'ID utente non valido: incolla l’ID Discord (solo numeri).', ephemeral: true });
        }
        await interaction.guild.members.unban(userId, reason);
        caseId = saveCase(interaction.guildId, userId, interaction.user.id, action, reason);
        await interaction.reply({ content: `Ban rimosso per \`${userId}\`. Caso #${caseId}.`, ephemeral: true });
      } else if (action === 'purge') {
        const amount = interaction.options.getInteger('quantita', true);
        const deleted = await interaction.channel.bulkDelete(amount, true);
        caseId = saveCase(interaction.guildId, interaction.user.id, interaction.user.id, action, `Eliminati ${deleted.size} messaggi`);
        await interaction.reply({
          content: `Eliminati ${deleted.size} messaggi. Caso #${caseId}.${deleted.size < amount ? '\nDiscord ignora i messaggi più vecchi di 14 giorni.' : ''}`,
          ephemeral: true
        });
      }

      if (caseId) logAction(interaction, { target, action, reason, caseId });
    } catch (error) {
      console.error('Errore moderazione:', error);
      const message = 'Operazione non riuscita. Controlla i permessi del bot, il ruolo gerarchico e l’ID utente.';
      if (interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
};

async function showHistory(interaction) {
  const user = interaction.options.getUser('utente', true);
  const limit = interaction.options.getInteger('quantita') || 10;
  const cases = listCases(interaction.guildId, user.id, limit);
  const total = countCases(interaction.guildId, user.id);
  const warns = countCases(interaction.guildId, user.id, 'warn');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Provvedimenti di ${user.tag}`)
    .setThumbnail(user.displayAvatarURL({ extension: 'png', size: 128 }))
    .addFields(
      { name: 'Totale casi', value: String(total), inline: true },
      { name: 'Avvertimenti', value: String(warns), inline: true }
    )
    .setFooter({ text: `ID ${user.id}` })
    .setTimestamp();

  embed.addFields({
    name: cases.length ? `Ultimi ${cases.length} casi` : 'Casi',
    value: cases.length ? formatCaseLines(cases).slice(0, 1024) : 'Nessun provvedimento registrato.'
  });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function voidCase(interaction) {
  const caseId = interaction.options.getInteger('caso', true);
  const item = getCase(interaction.guildId, caseId);
  if (!item) return interaction.reply({ content: `Caso #${caseId} non trovato.`, ephemeral: true });

  const removed = deleteCase(interaction.guildId, caseId);
  if (!removed) return interaction.reply({ content: `Caso #${caseId} non eliminato.`, ephemeral: true });

  await interaction.reply({
    content: `Caso #${caseId} (${item.action} su \`${item.user_id}\`) eliminato dallo storico. L’azione su Discord (timeout, ban, ecc.) non viene annullata.`,
    ephemeral: true
  });
  return sendLog(interaction.guild, 'moderation', 'Caso annullato', `Caso #${caseId} eliminato da ${interaction.user.tag}.`, [
    { name: 'Utente', value: `\`${item.user_id}\`` },
    { name: 'Azione originale', value: item.action },
    { name: 'Motivo originale', value: item.reason || '—' }
  ]);
}
