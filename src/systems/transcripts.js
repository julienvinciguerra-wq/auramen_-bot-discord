// Generazione dei transcript dei ticket in HTML autonomo (un solo file, apribile nel browser).

const MAX_MESSAGES = 1000;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

/** Scarica i messaggi del canale dal più vecchio al più recente (max 1000). */
async function fetchTranscriptMessages(channel) {
  const messages = [];
  let before;
  for (let page = 0; page < 10 && messages.length < MAX_MESSAGES; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return messages.slice(0, MAX_MESSAGES);
}

function authorBadges(message) {
  const badges = [];
  if (message.author?.bot) badges.push('BOT');
  if (message.webhookId || message.author?.bot === undefined && message.webhookId) badges.push('WEBHOOK');
  if (message.interaction) badges.push('COMANDO');
  return badges.map(badge => `<span class="badge">${badge}</span>`).join(' ');
}

function renderMessage(message) {
  const author = escapeHtml(message.author?.tag || message.author?.username || 'Utente sconosciuto');
  const avatar = escapeHtml(message.author?.displayAvatarURL?.({ extension: 'png', size: 64 }) || '');
  const content = escapeHtml(message.cleanContent || (message.attachments?.size ? '[Allegato]' : '[Messaggio senza testo]'))
    .replace(/\n/g, '<br>');

  const attachments = [...(message.attachments?.values?.() || [])].map(file =>
    `<p class="attachment">📎 <a href="${escapeHtml(file.url)}" rel="noopener noreferrer">${escapeHtml(file.name || 'Allegato')}</a></p>`
  ).join('');

  const embeds = (message.embeds || []).length
    ? `<p class="embed">[embed: ${escapeHtml(message.embeds.map(e => e.title || e.description || e.url || 'senza titolo').join(' • '))}]</p>`
    : '';

  return `<article class="message">${avatar ? `<img src="${avatar}" alt="">` : '<div class="avatar-placeholder"></div>'}<div class="message-body"><div class="meta"><strong>${author}</strong>${authorBadges(message)}<time>${formatDate(message.createdTimestamp)}</time></div><div>${content}</div>${attachments}${embeds}</div></article>`;
}

/**
 * Costruisce il file HTML del transcript di un ticket.
 * `messages` è opzionale: se non viene passato, i messaggi vengono scaricati dal canale.
 */
async function buildTicketTranscript(channel, ticket, messages) {
  const list = Array.isArray(messages) ? messages : await fetchTranscriptMessages(channel);
  const body = list.map(renderMessage).join('\n');
  const openedAt = ticket?.created_at ? formatDate(`${ticket.created_at}Z`) : '—';
  const closedAt = ticket?.closed_at ? formatDate(`${ticket.closed_at}Z`) : formatDate(new Date());
  const closedBy = ticket?.closed_by ? `<@${escapeHtml(ticket.closed_by)}>` : '—';

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transcript ticket #${escapeHtml(ticket?.id ?? '?')}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1000px;margin:32px auto;padding:24px}.header{background:#232428;border:1px solid #45464d;border-radius:12px;padding:22px;margin-bottom:18px}.header h1{margin:0 0 8px;color:#fff}.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px 18px;margin-top:10px}.muted,time{color:#aeb1b8;font-size:12px}.message{display:flex;gap:14px;padding:14px 12px;border-bottom:1px solid #3f4147}.message img,.avatar-placeholder{width:40px;height:40px;border-radius:50%;background:#45464d;flex:0 0 40px}.message-body{min-width:0;overflow-wrap:anywhere}.meta{display:flex;gap:10px;align-items:baseline;margin-bottom:4px;flex-wrap:wrap}.meta strong{color:#fff}.badge{background:#5865f2;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;letter-spacing:.04em}.message a{color:#00a8fc}.attachment{margin:6px 0 0}.embed{color:#aeb1b8;font-size:13px;margin:6px 0 0}.empty{color:#aeb1b8;padding:18px 12px}.footer{color:#949ba4;text-align:center;padding:24px;font-size:12px}@media(max-width:600px){.wrap{padding:12px;margin:8px auto}.header{padding:16px}}
  </style></head><body><main class="wrap"><header class="header"><h1>Transcript ticket #${escapeHtml(ticket?.id ?? '?')}</h1><div class="muted">Server: ${escapeHtml(channel?.guild?.name || '—')} • Canale: #${escapeHtml(channel?.name || '—')}</div><div class="meta-grid"><span class="muted">Aperto da: <@${escapeHtml(ticket?.opener_id || '?')}></span><span class="muted">Aperto il: ${openedAt}</span><span class="muted">Chiuso il: ${closedAt}</span><span class="muted">Chiuso da: ${closedBy}</span><span class="muted">Messaggi: ${list.length}</span></div></header>${body || '<p class="empty">Nessun messaggio nel ticket.</p>'}<footer class="footer">Generato da auramen bot • ${formatDate(new Date())}</footer></main></body></html>`;

  return Buffer.from(html, 'utf8');
}

module.exports = {
  escapeHtml,
  formatDate,
  fetchTranscriptMessages,
  buildTicketTranscript,
  MAX_MESSAGES
};
