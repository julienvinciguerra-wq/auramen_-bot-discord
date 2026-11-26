/**
 * Struttura del server auramen: ruoli, categorie e canali.
 *
 * I nomi sono la chiave: lo script non ricrea ciò che esiste già.
 * La struttura prepara solo i contenitori: ticket, conteggio, counter, regolamento
 * e giochi restano gestiti dal bot con i suoi comandi.
 */

const LINKS = {
  youtube: 'https://www.youtube.com/channel/UCQZZ5nB-KXesk0EzXOSZacA',
  twitch: 'https://twitch.tv/juliettamos',
  tiktok: 'https://www.tiktok.com/@auramen07'
};

/** Dal più alto al più basso. La creazione avviene al contrario per rispettare l'ordine. */
const ROLES = [
  { name: 'Admin', color: 0x8b5cf6 },
  { name: 'Moderatore', color: 0xf572b4 },
  { name: 'Staff', color: 0x38bdf8 },
  { name: 'Creator', color: 0xf59e0b },
  { name: 'Booster', color: 0xec4899 },
  { name: 'Live', color: 0xef4444, mentionable: true },
  { name: 'Novità video', color: 0xf472b6, mentionable: true },
  { name: 'Membro' }
];

const CATEGORIES = [
  {
    name: '📋 INFORMAZIONI',
    channels: [
      { name: 'benvenuto', readOnly: true, topic: 'Benvenuto nella community: il messaggio lo invia /welcome' },
      { name: 'regolamento', readOnly: true, topic: 'Il regolamento lo pubblica auramen con /regole' },
      { name: 'annunci', readOnly: true, topic: 'Annunci ufficiali del server' },
      { name: 'palinsesto', readOnly: true, topic: 'Quando sono online e cosa sto facendo' },
      { name: 'video', readOnly: true, topic: `Nuovi video: ${LINKS.youtube}` },
      { name: 'giveaway', readOnly: true, topic: 'Giveaway e iniziative della community' }
    ]
  },
  {
    name: '🌐 GENERAL',
    channels: [
      { name: '💬｜chat-generale', topic: 'Chat libera della community' },
      { name: '🤖｜chat-comandi', topic: 'Comandi del bot: /tris /rps-lizard-spock /battleship /counting' },
      { name: '📼｜clips-of-the-week', topic: 'Le clip migliori della settimana' },
      { name: '🎥｜video-community', topic: 'Video e clip creati dai membri' },
      { name: '📦｜texture-packs', type: 'announcement', readOnly: true, topic: 'Texture pack e resource pack della community' },
      { name: '⏰｜suggerimenti', type: 'announcement', readOnly: true, topic: 'Suggerimenti per migliorare il server' }
    ]
  },
  {
    name: '🎮 GIOCO',
    channels: [
      { name: 'showcase', topic: 'Mostra le tue build e i tuoi progetti' },
      { name: 'scambi', topic: 'Scambi e commerci tra membri' },
      { name: 'aiuto', topic: 'Aiuto su Minecraft e sul server' },
      { name: 'conteggio', readOnly: true, topic: 'Conta da 1 in ordine: si configura con /counting setup' }
    ]
  },
  {
    name: '⛏️ MINECRAFT',
    channels: [
      { name: 'ip-e-connessione', readOnly: true, topic: 'IP e istruzioni per entrare nel server Minecraft' },
      { name: 'whitelist', topic: 'Come chiedere la whitelist' },
      { name: 'modpack', topic: 'Versione, modpack e resource pack del server' },
      { name: 'build', topic: 'Progetti e cantieri della community' }
    ]
  },
  {
    name: '🎥 CONTENUTI',
    channels: [
      { name: 'youtube', readOnly: true, topic: `Nuovi video: ${LINKS.youtube}` },
      { name: 'live', readOnly: true, topic: `Live su Twitch: ${LINKS.twitch}` },
      { name: 'tiktok', readOnly: true, topic: `Clip e video brevi: ${LINKS.tiktok}` }
    ]
  },
  {
    name: '🎫 ASSISTENZA',
    channels: [
      { name: 'ticket', readOnly: true, topic: 'Apri un ticket con il pulsante qui sopra' },
      { name: 'segnalazioni', topic: 'Segnalazioni di membri e problemi' }
    ]
  },
  {
    name: '🛠️ STAFF',
    private: true,
    channels: [
      { name: 'staff-chat', topic: 'Coordinamento dello staff' },
      { name: 'segnalazioni-staff', topic: 'Segnalazioni da gestire' },
      { name: 'comandi-bot', topic: 'Promemoria comandi: /setup /ticket /regole /welcome' }
    ]
  },
  {
    name: '📋 LOG',
    private: true,
    channels: [
      { name: 'log-messaggi', topic: 'Messaggi eliminati e modificati (/setup logs categoria:messages)' },
      { name: 'log-membri', topic: 'Entrate, uscite e nickname (/setup logs categoria:members)' },
      { name: 'log-canali', topic: 'Canali creati, modificati ed eliminati (/setup logs categoria:channels)' },
      { name: 'log-ruoli', topic: 'Ruoli creati, modificati ed eliminati (/setup logs categoria:roles)' },
      { name: 'log-moderazione', topic: 'Sanzioni e provvedimenti (/setup logs categoria:moderation)' },
      { name: 'log-ticket', topic: 'Ticket aperti, chiusi e transcript (/setup logs categoria:ticket)' },
      { name: 'log-vocali', topic: 'Ingressi e uscite dai canali vocali (/setup logs categoria:voice)' },
      { name: 'log-server', topic: 'Modifiche al server (/setup logs categoria:server)' },
      { name: 'archivio-transcript', topic: 'Copie dei transcript dei ticket chiusi' }
    ]
  },
  {
    name: '🔊 VOCALI',
    channels: [
      { name: 'libero', type: 'voice' },
      { name: 'duo', type: 'voice' },
      { name: 'squadra', type: 'voice' },
      { name: 'raid', type: 'voice' },
      { name: 'AFK', type: 'voice' }
    ]
  }
];

module.exports = { LINKS, ROLES, CATEGORIES };
