/**
 * Contenuti pubblicati su YouTube, Twitch, TikTok e Kick, senza dipendenze.
 *
 * Ogni fetcher restituisce elementi normalizzati:
 *   { id, platform, title, url, thumbnail, publishedAt, live }
 * `id` è univoco per contenuto e serve a non pubblicare due volte lo stesso video.
 *
 * Credenziali: si passano dal database (configurate con `/feed setup`) oppure
 * dalle variabili d'ambiente. Servono a Twitch e Kick, che usano OAuth
 * client-credentials; YouTube (RSS) e TikTok (link) non le richiedono.
 */

const PLATFORMS = {
  youtube: {
    label: 'YouTube',
    color: 0xff0033,
    env: 'YOUTUBE_CHANNEL_ID',
    defaultAccount: 'UCQZZ5nB-KXesk0EzXOSZacA',
    channelHint: 'youtube',
    needsCredentials: false,
    credentialsEnv: null,
    accountHint: 'ID del canale (UC…)'
  },
  twitch: {
    label: 'Twitch',
    color: 0x9146ff,
    env: 'TWITCH_LOGIN',
    defaultAccount: 'auramen07',
    channelHint: 'live',
    needsCredentials: true,
    credentialsEnv: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
    accountHint: 'nome del canale Twitch',
    credentialsUrl: 'https://dev.twitch.tv/console/apps'
  },
  kick: {
    label: 'Kick',
    color: 0x53fc18,
    env: 'KICK_SLUG',
    defaultAccount: null,
    channelHint: 'live',
    needsCredentials: true,
    credentialsEnv: ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'],
    accountHint: 'slug del canale Kick (kick.com/<slug>)',
    credentialsUrl: 'https://kick.com/settings/developer'
  },
  tiktok: {
    label: 'TikTok',
    color: 0xfe2c55,
    env: 'TIKTOK_USERNAME',
    defaultAccount: 'auramen07',
    channelHint: 'tiktok',
    needsCredentials: false,
    credentialsEnv: null,
    accountHint: 'nome utente TikTok senza @'
  }
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

const tokens = new Map();

function isPlatform(value) {
  return Object.hasOwn(PLATFORMS, value);
}

/** Account configurato: comando, variabile d'ambiente, valore predefinito. */
function resolveAccount(platform, account) {
  const info = PLATFORMS[platform];
  if (!info) throw new TypeError(`Piattaforma sconosciuta: ${platform}`);
  const fromEnv = process.env[info.env];
  return String(account || fromEnv || info.defaultAccount || '').trim();
}

/** Credenziali per piattaforma: quelle salvate dai comandi hanno la precedenza. */
function resolveCredentials(platform, credentials = {}) {
  const info = PLATFORMS[platform];
  if (!info?.credentialsEnv) return { clientId: '', clientSecret: '' };
  const [idEnv, secretEnv] = info.credentialsEnv;
  return {
    clientId: String(credentials.clientId || process.env[idEnv] || '').trim(),
    clientSecret: String(credentials.clientSecret || process.env[secretEnv] || '').trim()
  };
}

function hasCredentials(platform, credentials = {}) {
  const info = PLATFORMS[platform];
  if (!info?.needsCredentials) return true;
  const { clientId, clientSecret } = resolveCredentials(platform, credentials);
  return Boolean(clientId && clientSecret);
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'it-IT,it;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} da ${url}`);
  return response.text();
}

async function fetchJson(url, headers = {}) {
  const text = await fetchText(url, { accept: 'application/json', ...headers });
  return JSON.parse(text);
}

/** Token OAuth client-credentials, in cache fino alla scadenza. */
async function clientCredentialsToken(cacheKey, tokenUrl, clientId, clientSecret, extra = {}) {
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    ...extra
  });
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Token OAuth: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('Token OAuth senza access_token');
  tokens.set(cacheKey, {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  });
  return data.access_token;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* --- YouTube: feed RSS pubblico del canale, nessuna chiave API ------------ */

/** Estrae i video dal feed XML `feeds/videos.xml?channel_id=…`. */
function parseYouTubeFeed(xml) {
  const items = [];
  const entries = String(xml || '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const entry of entries) {
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry);
    if (!videoId) continue;
    const id = videoId[1].trim();
    const title = /<title>([\s\S]*?)<\/title>/.exec(entry);
    const published = /<published>([^<]+)<\/published>/.exec(entry);
    items.push({
      id: `youtube:${id}`,
      platform: 'youtube',
      title: decodeEntities(title ? title[1] : '').trim() || 'Nuovo video su YouTube',
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      publishedAt: validDate(published ? published[1] : null),
      live: false
    });
  }
  return items;
}

async function fetchYouTube(channelId) {
  const id = resolveAccount('youtube', channelId);
  if (!id) throw new Error('Serve l’ID del canale YouTube (YOUTUBE_CHANNEL_ID).');
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`);
  return parseYouTubeFeed(xml).slice(0, 10);
}

/* --- Twitch: Helix con app token (dev.twitch.tv/console/apps) ------------- */

async function twitchRequest(path, credentials = {}) {
  const { clientId, clientSecret } = resolveCredentials('twitch', credentials);
  if (!clientId || !clientSecret) {
    throw new Error('Servono Client ID e Secret di Twitch: `/feed setup piattaforma:Twitch canale:… client_id:… client_secret:…`');
  }
  const token = await clientCredentialsToken(`twitch:${clientId}`, 'https://id.twitch.tv/oauth2/token', clientId, clientSecret);
  return fetchJson(`https://api.twitch.tv/helix/${path}`, {
    authorization: `Bearer ${token}`,
    'client-id': clientId
  });
}

function twitchThumbnail(url, width = 1280, height = 720) {
  return String(url || '')
    .replace('%{width}', String(width))
    .replace('%{height}', String(height))
    .replace('{width}', String(width))
    .replace('{height}', String(height));
}

/** Live in corso e ultimi VOD del canale Twitch. */
async function fetchTwitch(login, credentials = {}) {
  const user = resolveAccount('twitch', login);
  if (!user) throw new Error('Serve il nome del canale Twitch (TWITCH_LOGIN).');

  const users = await twitchRequest(`users?login=${encodeURIComponent(user.toLowerCase())}`, credentials);
  const channel = users?.data?.[0];
  if (!channel) throw new Error(`Canale Twitch "${user}" non trovato.`);

  const items = [];
  const streams = await twitchRequest(`streams?user_id=${encodeURIComponent(channel.id)}`, credentials);
  const stream = streams?.data?.[0];
  if (stream) {
    items.push({
      id: `twitch:live:${stream.id}`,
      platform: 'twitch',
      title: stream.title || 'Sono in diretta su Twitch',
      url: `https://www.twitch.tv/${channel.login}`,
      thumbnail: `${twitchThumbnail(stream.thumbnail_url)}?t=${Math.floor(Date.now() / 60000)}`,
      publishedAt: validDate(stream.started_at),
      live: true
    });
  }

  const videos = await twitchRequest(
    `videos?user_id=${encodeURIComponent(channel.id)}&first=5&type=archive`,
    credentials
  );
  for (const video of videos?.data || []) {
    items.push({
      id: `twitch:video:${video.id}`,
      platform: 'twitch',
      title: video.title || 'Nuovo video su Twitch',
      url: video.url,
      thumbnail: twitchThumbnail(video.thumbnail_url),
      publishedAt: validDate(video.published_at),
      live: false
    });
  }

  return items;
}

/* --- Kick: API ufficiale v1 con app token (kick.com/settings/developer) --- */

/** Converte la risposta di `/public/v1/channels` in un annuncio, se è live. */
function parseKickChannel(payload, slug) {
  const channel = payload?.data?.[0];
  if (!channel) return [];
  const stream = channel.stream;
  if (!stream?.is_live) return [];

  const name = channel.slug || slug;
  return [{
    id: `kick:live:${name}:${stream.start_time || stream.url || Date.now()}`,
    platform: 'kick',
    title: channel.stream_title || stream.title || 'Sono in diretta su Kick',
    url: stream.url || `https://kick.com/${name}`,
    thumbnail: stream.thumbnail || null,
    publishedAt: validDate(stream.start_time),
    live: true
  }];
}

async function fetchKick(slug, credentials = {}) {
  const name = resolveAccount('kick', slug).replace(/^@/, '');
  if (!name) throw new Error('Serve lo slug del canale Kick (KICK_SLUG).');

  const { clientId, clientSecret } = resolveCredentials('kick', credentials);
  if (!clientId || !clientSecret) {
    throw new Error('Servono Client ID e Secret di Kick: `/feed setup piattaforma:Kick canale:… client_id:… client_secret:…`');
  }

  const token = await clientCredentialsToken(
    `kick:${clientId}`,
    'https://id.kick.com/oauth/token',
    clientId,
    clientSecret
  );
  const payload = await fetchJson(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(name.toLowerCase())}`,
    { authorization: `Bearer ${token}` }
  );
  return parseKickChannel(payload, name);
}

/* --- TikTok: pagina pubblica del profilo, nessuna chiave API ------------- */

function tiktokCover(node) {
  const candidates = [
    node?.video?.cover,
    node?.video?.originCover,
    node?.video?.dynamicCover,
    node?.covers?.default,
    node?.covers?.[0]
  ];
  return candidates.find(value => typeof value === 'string' && value.startsWith('http')) || null;
}

/** Estrae i video dalla pagina profilo (JSON incorporato o link nell'HTML). */
function parseTikTokProfile(html, username) {
  const source = String(html || '');
  const found = new Map();

  const script = /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(source);
  let data = null;
  if (script) {
    try { data = JSON.parse(script[1]); } catch { data = null; }
  }

  const hasText = node => typeof node.desc === 'string';

  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const rawId = node.id ?? node.aweme_id ?? node.itemId;
    const id = rawId === undefined || rawId === null ? '' : String(rawId);
    if (/^\d{17,20}$/.test(id) && (hasText(node) || node.video)) {
      if (!found.has(id)) found.set(id, node);
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  if (data) visit(data);

  if (!found.size) {
    for (const match of source.matchAll(/\/@[\w.\-]+\/video\/(\d{17,20})/g)) {
      if (!found.has(match[1])) found.set(match[1], { id: match[1] });
    }
  }

  const name = String(username || '').replace(/^@/, '');
  return [...found.entries()].map(([id, node]) => ({
    id: `tiktok:${id}`,
    platform: 'tiktok',
    title: (typeof node.desc === 'string' ? node.desc.trim() : '') || 'Nuovo video su TikTok',
    url: `https://www.tiktok.com/@${name}/video/${id}`,
    thumbnail: tiktokCover(node),
    publishedAt: validDate(
      node.createTime ? new Date(Number(node.createTime) * 1000).toISOString() : node.createTimeISO || null
    ),
    live: false
  }));
}

async function fetchTikTok(username) {
  const user = resolveAccount('tiktok', username).replace(/^@/, '');
  if (!user) throw new Error('Serve il nome utente TikTok (TIKTOK_USERNAME).');
  const html = await fetchText(`https://www.tiktok.com/@${encodeURIComponent(user)}?lang=it`);
  const items = parseTikTokProfile(html, user);
  if (!items.length) throw new Error('TikTok non ha restituito video (pagina bloccata o profilo privato).');
  return items.slice(0, 10);
}

/**
 * Scheda di un video TikTok condiviso a mano: l'oEmbed pubblico dà titolo e
 * copertina senza chiavi, se risponde; altrimenti si pubblica il solo link.
 */
async function fetchTikTokOembed(url, username) {
  const match = /tiktok\.com\/(?:@[\w.\-]+\/)?video\/(\d{17,20})/.exec(String(url || ''));
  const id = match ? match[1] : null;
  const author = String(username || resolveAccount('tiktok', null)).replace(/^@/, '');
  const clean = id ? `https://www.tiktok.com/@${author}/video/${id}` : null;
  const base = {
    id: `tiktok:${id || Date.now()}`,
    platform: 'tiktok',
    title: 'Nuovo video su TikTok',
    url: clean || String(url || '').trim(),
    thumbnail: null,
    publishedAt: new Date().toISOString(),
    live: false
  };
  if (!clean) return base;

  try {
    const data = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(clean)}`);
    return {
      ...base,
      title: String(data.title || base.title).slice(0, 200),
      thumbnail: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null
    };
  } catch {
    return base;
  }
}

/** Recupera i contenuti recenti di una piattaforma. */
function fetchRecent(platform, account, credentials = {}) {
  if (platform === 'youtube') return fetchYouTube(account);
  if (platform === 'twitch') return fetchTwitch(account, credentials);
  if (platform === 'kick') return fetchKick(account, credentials);
  if (platform === 'tiktok') return fetchTikTok(account);
  return Promise.reject(new TypeError(`Piattaforma sconosciuta: ${platform}`));
}

/** Dal più recente al più vecchio; i live restano in cima. */
function sortNewest(items) {
  return [...items].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const first = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const second = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return second - first;
  });
}

module.exports = {
  PLATFORMS,
  isPlatform,
  resolveAccount,
  resolveCredentials,
  hasCredentials,
  parseYouTubeFeed,
  parseKickChannel,
  parseTikTokProfile,
  fetchTikTokOembed,
  fetchRecent,
  sortNewest
};
