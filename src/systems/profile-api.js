const http = require('node:http');
const { Events, ActivityType } = require('discord.js');

const USER_ID = process.env.DISCORD_USER_ID || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1550243283438018660';
const PORT = Number(process.env.PORT || process.env.PROFILE_API_PORT || 3001);
const allowedOrigins = (process.env.SITE_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function findCachedPresence(client) {
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(USER_ID);
    if (member && member.presence) return member.presence;
  }
  return null;
}

function makeCustomStatus(presence) {
  if (!presence || !Array.isArray(presence.activities)) return '';
  const activity = presence.activities.find(item => item.type === ActivityType.Custom);
  if (!activity) return '';
  const emoji = activity.emoji && activity.emoji.name ? activity.emoji.name : '';
  const state = typeof activity.state === 'string' ? activity.state : '';
  return [emoji, state].filter(Boolean).join(' ').trim();
}


function startProfileApi(client) {
  let latestPresence = null;
  let profileSnapshot = {
    userId: USER_ID,
    displayName: 'auramen_',
    username: 'auramen_',
    avatarUrl: null,
    status: 'offline',
    customStatus: '',
    updatedAt: new Date().toISOString()
  };
  let serverSnapshot = {
    available: false,
    guildId: GUILD_ID || null,
    name: '',
    iconUrl: null,
    bannerUrl: null,
    description: '',
    memberCount: null,
    updatedAt: new Date().toISOString()
  };

  let serversSnapshot = {
    available: true,
    servers: [],
    updatedAt: new Date().toISOString()
  };

  async function refreshServers() {
    try {
      const servers = client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount ?? null
      })).sort((a, b) => a.name.localeCompare(b.name, 'it'));
      serversSnapshot = {
        available: true,
        servers,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Aggiornamento contatori server Discord non riuscito:', error.message);
      serversSnapshot = { ...serversSnapshot, available: false, updatedAt: new Date().toISOString() };
    }
  }

  async function refreshProfile() {
    if (!USER_ID || !/^\\d{17,20}$/.test(USER_ID)) return;
    try {
      const user = await client.users.fetch(USER_ID, { force: true });
      const presence = latestPresence || findCachedPresence(client);
      profileSnapshot = {
        userId: USER_ID,
        displayName: user.globalName || user.username,
        username: user.username,
        avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
        status: presence && presence.status ? presence.status : 'offline',
        customStatus: makeCustomStatus(presence),
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Aggiornamento profilo Discord non riuscito:', error.message);
    }
  }

  function resolveGuildId() {
    if (GUILD_ID && /^\\d{17,20}$/.test(GUILD_ID)) return GUILD_ID;
    if (client.guilds.cache.size === 1) return client.guilds.cache.first().id;
    return null;
  }

  async function refreshServer() {
    const guildId = resolveGuildId();
    if (!guildId) {
      console.warn('Server Discord non selezionato: configura DISCORD_GUILD_ID su Render.');
      return;
    }

    try {
      const guild = await client.guilds.fetch(guildId);
      serverSnapshot = {
        available: true,
        guildId: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ extension: 'png', size: 512 }),
        bannerUrl: guild.bannerURL({ extension: 'png', size: 1024 }),
        description: guild.description || '',
        memberCount: guild.memberCount ?? null,
        updatedAt: new Date().toISOString()
      };
      await refreshServers();
    } catch (error) {
      console.error('Aggiornamento server Discord non riuscito:', error.message);
      serverSnapshot = { ...serverSnapshot, available: false, updatedAt: new Date().toISOString() };
    }
  }

  const server = http.createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' });
      response.end(JSON.stringify({ error: 'Origin non autorizzata' }));
      return;
    }

    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigins.length ? origin : '*');
      if (allowedOrigins.length) response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept');
    response.setHeader('Cache-Control', 'public, max-age=15');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'GET' || !['/api/discord-profile', '/api/discord-server', '/api/discord-servers'].includes(pathname)) {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (pathname === '/api/discord-profile' && (!USER_ID || !/^\\d{17,20}$/.test(USER_ID))) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'DISCORD_USER_ID non configurato' }));
      return;
    }

    if (pathname === '/api/discord-servers' && !serversSnapshot.available) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Contatori server Discord non ancora disponibili' }));
      return;
    }

    if (pathname === '/api/discord-server' && !serverSnapshot.available) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Server Discord non ancora disponibile' }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(pathname === '/api/discord-profile' ? profileSnapshot : pathname === '/api/discord-servers' ? serversSnapshot : serverSnapshot));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('API Discord in ascolto sulla porta ' + PORT);
    if (!USER_ID) console.warn('DISCORD_USER_ID non configurato: API profilo disattivata.');
  });

  client.on(Events.UserUpdate, (_oldUser, newUser) => {
    if (newUser && newUser.id === USER_ID) refreshProfile();
  });
  client.on(Events.PresenceUpdate, (_oldPresence, newPresence) => {
    if (newPresence && newPresence.userId === USER_ID) {
      latestPresence = newPresence;
      refreshProfile();
    }
  });

  const refreshGuildIfTarget = guild => {
    const targetId = resolveGuildId();
    if (guild && targetId && guild.id === targetId) refreshServer();
  };
  client.on(Events.GuildUpdate, (_oldGuild, newGuild) => { refreshGuildIfTarget(newGuild); refreshServers(); });\n  client.on(Events.GuildCreate, () => refreshServers());\n  client.on(Events.GuildDelete, () => refreshServers());
  client.on(Events.GuildMemberAdd, member => refreshGuildIfTarget(member.guild));
  client.on(Events.GuildMemberRemove, member => refreshGuildIfTarget(member.guild));
  client.on(Events.ChannelCreate, channel => refreshGuildIfTarget(channel.guild));
  client.on(Events.ChannelDelete, channel => refreshGuildIfTarget(channel.guild));
  client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => refreshGuildIfTarget(newChannel.guild));

  client.once(Events.ClientReady, () => {
    refreshProfile();
    refreshServer();\n    refreshServers();\n    const timer = setInterval(() => {
      refreshProfile();
      refreshServer();\n      refreshServers();\n    }, 60000);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return server;
}

module.exports = { startProfileApi };
