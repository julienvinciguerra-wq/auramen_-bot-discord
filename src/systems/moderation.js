const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../database/database');

/**
 * Controlli di sicurezza prima di una sanzione.
 * Ritorna il messaggio di errore da mostrare, oppure null se l'azione è permessa.
 */
function moderationBlock(interaction, member, action) {
  const guild = interaction.guild;
  const me = guild?.members?.me;
  const target = member;

  if (!target) return 'Utente non trovato nel server.';
  if (target.id === interaction.user.id) return 'Non puoi usare questo comando su te stesso.';
  if (target.id === guild.ownerId) return 'Non puoi sanzionare il proprietario del server.';

  const isOwner = interaction.user.id === guild.ownerId;
  const moderatorPosition = interaction.member?.roles?.highest?.position ?? 0;
  const targetPosition = target.roles?.highest?.position ?? 0;
  if (!isOwner && moderatorPosition <= targetPosition) {
    return 'Non puoi agire su un membro con un ruolo pari o superiore al tuo.';
  }

  if (me && targetPosition >= (me.roles?.highest?.position ?? 0)) {
    return 'Il ruolo del bot è troppo in basso per agire su questo membro: sposta il ruolo del bot più in alto.';
  }

  if (action === 'ban' && me && !target.bannable) {
    return 'Il bot non può bannare questo utente (permessi mancanti o ruolo troppo alto).';
  }
  if (['kick', 'timeout', 'untimeout'].includes(action) && me && !target.manageable) {
    return 'Il bot non può gestire questo utente (permessi mancanti o ruolo troppo alto).';
  }

  return null;
}

/** Verifica se il membro è staff per la moderazione: admin oppure un ruolo configurato in /setup permessi. */
function hasModerationAccess(interaction, config) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.member?.id === interaction.guild?.ownerId) return true;
  return Object.values(config.commandPermissions || {})
    .some(rule => rule?.roleId && interaction.member?.roles?.cache?.has(rule.roleId));
}

function listCases(guildId, userId, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  return db.prepare(`
    SELECT * FROM moderation_cases
    WHERE guild_id = ? AND user_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(guildId, userId, safeLimit);
}

function countCases(guildId, userId, action) {
  if (action) {
    return db.prepare('SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id = ? AND user_id = ? AND action = ?')
      .get(guildId, userId, action).n;
  }
  return db.prepare('SELECT COUNT(*) AS n FROM moderation_cases WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId).n;
}

function getCase(guildId, caseId) {
  return db.prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND id = ?').get(guildId, caseId) || null;
}

/** Elimina un caso (usato per annullare un warn registrato per errore). */
function deleteCase(guildId, caseId) {
  return db.prepare('DELETE FROM moderation_cases WHERE guild_id = ? AND id = ?').run(guildId, caseId).changes > 0;
}

/** Avvisa l'utente in DM; se ha i DM chiusi non blocca l'azione. */
async function notifyMember(user, guild, actionLabel, reason) {
  if (!user) return false;
  try {
    await user.send(`Nel server **${guild.name}** hai ricevuto: **${actionLabel}**.\nMotivo: ${reason}`);
    return true;
  } catch {
    return false;
  }
}

/** Riassunto leggibile dei casi in un embed (usato da /moderazione storico). */
function formatCaseLines(cases) {
  return cases.map(item => {
    const date = item.created_at ? ` • ${item.created_at}` : '';
    const reason = item.reason ? ` — ${item.reason}` : '';
    return `**#${item.id}** · ${item.action}${date}${reason}`;
  }).join('\n');
}

module.exports = {
  moderationBlock,
  hasModerationAccess,
  listCases,
  countCases,
  getCase,
  deleteCase,
  notifyMember,
  formatCaseLines
};
