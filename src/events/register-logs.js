const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, short } = require('../systems/logger');

function registerLogs(client) {
  client.on(Events.GuildMemberAdd, member => {
    sendLog(member.guild, 'members', 'Membro entrato', `${member.user.tag} è entrato nel server.`, [
      { name: 'Utente', value: `${member.user.tag} (\`${member.id}\`)` }
    ]);
  });

  client.on(Events.GuildMemberRemove, async member => {
    let executor = 'Non identificato';
    try {
      const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 });
      const entry = logs.entries.find(item =>
        item.target?.id === member.id && Date.now() - item.createdTimestamp < 15000
      );
      if (entry) executor = `${entry.executor.tag} (\`${entry.executor.id}\`)`;
    } catch {}
    sendLog(member.guild, 'members', 'Membro uscito o rimosso',
      `${member.user?.tag || member.id} non è più nel server.`, [
        { name: 'ID utente', value: member.id },
        { name: 'Possibile responsabile', value: executor }
      ]);
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
      sendLog(newMember.guild, 'members', 'Nickname modificato', `Modifica nickname di <@${newMember.id}>.`, [
        { name: 'Prima', value: short(oldMember.nickname || oldMember.user.username) },
        { name: 'Dopo', value: short(newMember.nickname || newMember.user.username) }
      ]);
    }
    const before = new Set(oldMember.roles.cache.keys());
    const after = new Set(newMember.roles.cache.keys());
    const added = [...after].filter(id => !before.has(id));
    const removed = [...before].filter(id => !after.has(id));
    if (added.length || removed.length) {
      sendLog(newMember.guild, 'roles', 'Ruoli membro aggiornati', `Ruoli modificati per <@${newMember.id}>.`, [
        { name: 'Aggiunti', value: added.map(id => `<@&${id}>`).join(', ') || '—' },
        { name: 'Rimossi', value: removed.map(id => `<@&${id}>`).join(', ') || '—' }
      ]);
    }
  });

  client.on(Events.MessageDelete, message => {
    if (!message.guild || message.author?.bot) return;
    sendLog(message.guild, 'messages', 'Messaggio eliminato', `Messaggio eliminato in <#${message.channelId}>.`, [
      { name: 'Autore', value: message.author ? `${message.author.tag} (\`${message.author.id}\`)` : 'Non disponibile' },
      { name: 'Contenuto disponibile', value: short(message.content || '[contenuto non disponibile]') }
    ]);
  });

  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.partial || newMessage.partial || oldMessage.content === newMessage.content) return;
    sendLog(newMessage.guild, 'messages', 'Messaggio modificato', `Messaggio modificato in <#${newMessage.channelId}>.`, [
      { name: 'Autore', value: newMessage.author ? `${newMessage.author.tag} (\`${newMessage.author.id}\`)` : 'Non disponibile' },
      { name: 'Prima', value: short(oldMessage.content) },
      { name: 'Dopo', value: short(newMessage.content) }
    ]);
  });

  client.on(Events.ChannelCreate, channel => {
    if (channel.guild) sendLog(channel.guild, 'channels', 'Canale creato', `Creato ${channel}.`, [
      { name: 'Nome', value: channel.name },
      { name: 'ID', value: channel.id }
    ]);
  });

  client.on(Events.ChannelDelete, channel => {
    if (channel.guild) sendLog(channel.guild, 'channels', 'Canale eliminato', `Eliminato il canale ${channel.name}.`, [
      { name: 'Nome', value: channel.name },
      { name: 'ID', value: channel.id }
    ]);
  });

  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push({ name: 'Nome', value: `${short(oldChannel.name)} → ${short(newChannel.name)}` });
    if (oldChannel.parentId !== newChannel.parentId) changes.push({ name: 'Categoria', value: `${oldChannel.parentId || 'Nessuna'} → ${newChannel.parentId || 'Nessuna'}` });
    if (oldChannel.topic !== newChannel.topic) changes.push({ name: 'Descrizione', value: `${short(oldChannel.topic)} → ${short(newChannel.topic)}` });
    if (changes.length) sendLog(newChannel.guild, 'channels', 'Canale modificato', `Aggiornato ${newChannel}.`, changes);
  });

  client.on(Events.GuildRoleCreate, role => {
    sendLog(role.guild, 'roles', 'Ruolo creato', `Creato il ruolo <@&${role.id}>.`, [
      { name: 'Nome', value: role.name },
      { name: 'ID', value: role.id }
    ]);
  });

  client.on(Events.GuildRoleDelete, role => {
    sendLog(role.guild, 'roles', 'Ruolo eliminato', `Eliminato il ruolo **${role.name}**.`, [
      { name: 'ID', value: role.id }
    ]);
  });

  client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push({ name: 'Nome', value: `${oldRole.name} → ${newRole.name}` });
    if (oldRole.hexColor !== newRole.hexColor) changes.push({ name: 'Colore', value: `${oldRole.hexColor} → ${newRole.hexColor}` });
    if (oldRole.hoist !== newRole.hoist) changes.push({ name: 'Separato', value: `${oldRole.hoist} → ${newRole.hoist}` });
    if (changes.length) sendLog(newRole.guild, 'roles', 'Ruolo modificato', `Aggiornato <@&${newRole.id}>.`, changes);
  });

  client.on(Events.GuildBanAdd, ban => {
    sendLog(ban.guild, 'moderation', 'Utente bannato', `Ban applicato a ${ban.user.tag}.`, [
      { name: 'Utente', value: `\`${ban.user.id}\`` },
      { name: 'Motivo', value: short(ban.reason) }
    ]);
  });

  client.on(Events.GuildBanRemove, ban => {
    sendLog(ban.guild, 'moderation', 'Ban rimosso', `Ban rimosso per ${ban.user.tag}.`, [
      { name: 'Utente', value: `\`${ban.user.id}\`` }
    ]);
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member) return;
    let title = 'Stato vocale aggiornato';
    let description = `${member.user.tag} ha cambiato stato vocale.`;
    if (!oldState.channelId && newState.channelId) {
      title = 'Ingresso in vocale';
      description = `${member.user.tag} è entrato in <#${newState.channelId}>.`;
    } else if (oldState.channelId && !newState.channelId) {
      title = 'Uscita dalla vocale';
      description = `${member.user.tag} è uscito da <#${oldState.channelId}>.`;
    } else if (oldState.channelId !== newState.channelId) {
      title = 'Spostamento vocale';
      description = `${member.user.tag}: <#${oldState.channelId}> → <#${newState.channelId}>.`;
    } else {
      return;
    }
    sendLog(member.guild, 'voice', title, description);
  });

  client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push({ name: 'Nome', value: `${oldGuild.name} → ${newGuild.name}` });
    if (oldGuild.icon !== newGuild.icon) changes.push({ name: 'Icona', value: 'Icona del server modificata' });
    if (changes.length) sendLog(newGuild, 'server', 'Server modificato', 'Sono state rilevate modifiche alle impostazioni principali.', changes);
  });
}

module.exports = { registerLogs };
