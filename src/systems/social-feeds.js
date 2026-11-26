/**
 * Contenuti pubblicati su YouTube, Twitch e TikTok, senza dipendenze esterne.
 *
 * Ogni fetcher restituisce elementi normalizzati:
 *   { id, platform, title, url, thumbnail, publishedAt, live }
 * `id` è univoco per contenuto e serve a non pubblicare due volte lo stesso video.
 */

const PLATFORMS = {
  youtube: {
    label: 'YouTube',
    color: 0xff0033,
    env: 'YOUTUBE_CHANNEL_ID',
    defaultAccount: 'UCQZZ5nB-KXesk0EzXOSZacA',
    channelHint: 'youtube'
  },
  twitch: {
    label: 'Twitch',
    color: 0x9146ff,
    env: 'TWITCH_LOGIN',
    defaultAccount: 'juliettamos',
    channelHint: 'live'
  },
  tiktok: {
    label: 'TikTok',
    color: 0xfe2c55,
    env: 'TIKTOK_USERNAME',
    defaultAccount: 'auramen07',
    channelHint: 'tiktok'
  }
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

function isPlatform(value) {
  return Object.hasOwn(PLATFORMS, value);
}

/** Account configurato: variabile d'ambiente, poi il valore predefinito. */
function resolveAccount(platform, account) {
  const info = PLATFORMS[platform];
  if (!info) throw new TypeError(`Piattaforma sconosciuta: ${platform}`);
  const fromEnv = process.env[info.env];
  return String(account || fromEnv || info.defaultAccount || '').trim();
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

/* --- Twitch: Helix con client credentials (serve un'app su dev.twitch.tv) - */

let twitchToken = null;

async function twitchAccessToken() {
  if (twitchToken && twitchToken.expiresAt > Date.now() + 60000) return twitchToken.value;

  const clientId = String(process.env.TWITCH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Servono TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env');
  }

  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Twitch OAuth: HTTP ${response.status}`);
  const data = await response.json();
  twitchToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return twitchToken.value;
}

async function twitchRequest(path) {
  const token = await twitchAccessToken();
  const data = await fetchJson(`https://api.twitch.tv/helix/${path}`, {
    authorization: `Bearer ${token}`,
    'client-id': String(process.env.TWITCH_CLIENT_ID).trim()
  });
  return data;
}

function twitchThumbnail(url, width = 1280, height = 720) {
  return String(url || '')
    .replace('%{width}', String(width))
    .replace('%{height}', String(height))
    .replace('{width}', String(width))
    .replace('{height}', String(height));
}

/** Live in corso e ultimi VOD del canale Twitch. */
async function fetchTwitch(login) {
  const user = resolveAccount('twitch', login);
  if (!user) throw new Error('Serve il nome del canale Twitch (TWITCH_LOGIN).');

  const users = await twitchRequest(`users?login=${encodeURIComponent(user.toLowerCase())}`);
  const channel = users?.data?.[0];
  if (!channel) throw new Error(`Canale Twitch "${user}" non trovato.`);

  const items = [];
  const streams = await twitchRequest(`streams?user_id=${encodeURIComponent(channel.id)}`);
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
    `videos?user_id=${encodeURIComponent(channel.id)}&first=5&type=archive`
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
async function fetchTikTokOembed(url) {
  const match = /tiktok\.com\/(?:@[\w.\-]+\/)?video\/(\d{17,20})/.exec(String(url || ''));
  const id = match ? match[1] : null;
  const clean = id ? `https://www.tiktok.com/@${resolveAccount('tiktok', null)}/video/${id}` : null;
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
function fetchRecent(platform, account) {
  if (platform === 'youtube') return fetchYouTube(account);
  if (platform === 'twitch') return fetchTwitch(account);
  if (platform === 'tiktok') return fetchTikTok(account);
  throw new TypeError(`Piattaforma sconosciuta: ${platform}`);
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
  parseYouTubeFeed,
  parseTikTokProfile,
  fetchTikTokOembed,
  fetchRecent,
  sortNewest
};
