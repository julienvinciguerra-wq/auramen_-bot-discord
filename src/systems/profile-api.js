const http = require('node:http');
const { Events, ActivityType } = require('discord.js');

const USER_ID = process.env.DISCORD_USER_ID || '';
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
  let snapshot = {
    userId: USER_ID,
    displayName: 'auramen_',
    username: 'auramen_',
    avatarUrl: null,
    status: 'offline',
    customStatus: '',
    updatedAt: new Date().toISOString()
  };

  async function refreshProfile() {
    if (!USER_ID || !/^\d{17,20}$/.test(USER_ID)) return;
    try {
      const user = await client.users.fetch(USER_ID, { force: true });
      const presence = latestPresence || findCachedPresence(client);
      snapshot = {
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
    if (request.method !== 'GET' || pathname !== '/api/discord-profile') {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (!USER_ID || !/^\d{17,20}$/.test(USER_ID)) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'DISCORD_USER_ID non configurato' }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(snapshot));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('API profilo Discord in ascolto sulla porta ' + PORT);
    if (!USER_ID) console.warn('DISCORD_USER_ID non configurato: API profilo disattivata.');
  });

  client.on(Events.PresenceUpdate, (_oldPresence, newPresence) => {
    if (newPresence && newPresence.userId === USER_ID) {
      latestPresence = newPresence;
      refreshProfile();
    }
  });

  client.once(Events.ClientReady, () => {
    refreshProfile();
    const timer = setInterval(refreshProfile, 60000);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return server;
}

module.exports = { startProfileApi };
