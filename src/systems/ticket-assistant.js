const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const { db } = require('../database/database');

const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'settings.json');
const IMAGE_ROOT = path.join(process.cwd(), 'knowledge', 'images');

const SETTINGS_TERMS = [
  'setting', 'settings', 'impostazion', 'settagg', 'configurazion', 'config',
  'sensibilit', 'sens', 'grafica', 'video', 'audio', 'tastier', 'keybind',
  'bind', 'risoluzion', 'fps', 'dpi', 'hud', 'crosshair', 'reticolo',
  'comandi', 'setup', 'come giochi', 'come hai impostato'
];

const STOP_WORDS = new Set([
  'quali', 'quale', 'sono', 'mi', 'miei', 'mie', 'tuoi', 'tue', 'di', 'del',
  'della', 'delle', 'degli', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una',
  'uno', 'per', 'su', 'in', 'a', 'da', 'che', 'come', 'hai', 'uso', 'usi',
  'manda', 'mandi', 'dammi', 'dimmi', 'vorrei', 'puoi', 'avere', 'avete',
  'auramen', 'impostazioni', 'settings', 'settaggi', 'configurazione'
]);

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(value) {
  return normalize(value).split(/\s+/).filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

function isSettingsQuestion(content) {
  const text = normalize(content);
  return SETTINGS_TERMS.some(term => text.includes(normalize(term)));
}

function loadKnowledge() {
  try {
    const parsed = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    console.error('[Ticket assistant] Impossibile leggere knowledge/settings.json:', error.message);
    return [];
  }
}

function scoreEntry(content, entry) {
  const queryWords = new Set(words(content));
  const searchable = [
    entry.game, entry.title, entry.description,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry.sections) ? entry.sections.flatMap(section => [
      section.name, section.value, ...(section.aliases || [])
    ]) : [])
  ].join(' ');
  const entryWords = new Set(words(searchable));
  let score = 0;
  for (const word of queryWords) {
    if (entryWords.has(word)) score += 2;
    else if ([...entryWords].some(candidate => candidate.startsWith(word) || word.startsWith(candidate))) score += 1;
  }
  const normalizedQuery = normalize(content);
  for (const alias of entry.aliases || []) {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias.length > 3 && normalizedQuery.includes(normalizedAlias)) score += 5;
  }
  if (entry.game && normalizedQuery.includes(normalize(entry.game))) score += 5;
  return score;
}

function formatEntry(entry) {
  const lines = [
    `**Impostazioni AURAMEN — ${entry.game || 'Configurazione'}**`,
    entry.title ? `*${entry.title}*` : '',
    entry.description || ''
  ].filter(Boolean);

  for (const section of entry.sections || []) {
    lines.push('', `**${section.name || 'Impostazioni'}**`);
    if (Array.isArray(section.items)) {
      for (const item of section.items) lines.push(`• **${item.name}:** ${item.value}`);
    } else if (section.value) {
      lines.push(section.value);
    }
  }
  if (entry.notes) lines.push('', `_Note: ${entry.notes}_`);
  return lines.join('\n').slice(0, 1900);
}

async function handleTicketMessage(message) {
  if (!message.guild || message.author?.bot || !message.content?.trim()) return false;
  if (!isSettingsQuestion(message.content)) return false;

  const ticket = db.prepare(
    "SELECT id FROM tickets WHERE guild_id = ? AND channel_id = ? AND status = 'open'"
  ).get(message.guild.id, message.channel.id);
  if (!ticket) return false;

  const entries = loadKnowledge();
  if (!entries.length) {
    await message.reply({
      content: 'Sto preparando l’archivio delle impostazioni AURAMEN. Al momento non ci sono ancora configurazioni verificate da inviarti. Specifica il gioco o il programma che cerchi: lo staff potrà aggiungere i dati corretti.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const ranked = entries
    .map(entry => ({ entry, score: scoreEntry(message.content, entry) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 2) {
    await message.reply({
      content: 'Ho capito che cerchi delle impostazioni, ma non ho trovato una corrispondenza abbastanza precisa nell’archivio AURAMEN. Puoi indicarmi il gioco o il programma e la sezione che ti interessa?',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const entry = ranked[0].entry;
  const payload = { content: formatEntry(entry), allowedMentions: { parse: [] } };
  const imagePaths = [];
  if (Array.isArray(entry.images)) {
    for (const image of entry.images) {
      const relative = String(image || '').replace(/\\/g, '/');
      const fullPath = path.resolve(IMAGE_ROOT, relative);
      if (fullPath.startsWith(IMAGE_ROOT + path.sep) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        imagePaths.push(fullPath);
      }
    }
  }
  if (imagePaths.length) {
    payload.files = imagePaths.slice(0, 10).map(file => new AttachmentBuilder(file));
  } else if (entry.imageUrl && /^https:\/\//i.test(entry.imageUrl)) {
    payload.content += `\n\n[Apri immagine delle impostazioni](${entry.imageUrl})`;
  }

  await message.reply(payload);
  return true;
}

module.exports = { handleTicketMessage, isSettingsQuestion, scoreEntry, formatEntry };
