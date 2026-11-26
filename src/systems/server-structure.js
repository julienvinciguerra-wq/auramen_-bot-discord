/**
 * Struttura del server auramen: ruoli, categorie e canali.
 *
 * I nomi sono la chiave: lo script non ricrea ciò che esiste già.
 * La struttura non duplica ticket, counter, regolamento, conteggio e giochi,
 * perché li gestisce già il bot con i suoi comandi.
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
    name: '👋 BENVENUTO',
    channels: [
      { name: 'benvenuto', readOnly: true, topic: 'Benvenuto nella community di auramen' },
      { name: 'regole', readOnly: true, topic: 'Il regolamento lo pubblica auramen con /regole' },
      { name: 'annunci', readOnly: true, topic: 'Annunci ufficiali del server' },
      { name: 'ruoli', topic: 'Reagisci ai messaggi per prendere i tuoi ruoli' }
    ]
  },
  {
    name: '💬 COMMUNITY',
    channels: [
      { name: 'generale', topic: 'Chat libera della community' },
      { name: 'presentazioni', topic: 'Presentati alla community' },
      { name: 'meme', topic: 'Meme e momenti divertenti' },
      { name: 'clip', topic: 'Clip e giocate migliori' }
    ]
  },
  {
    name: '⛏️ MINECRAFT',
    channels: [
      { name: 'ip-e-connessione', readOnly: true, topic: 'IP e istruzioni per entrare nel server Minecraft' },
      { name: 'whitelist', topic: 'Come chiedere la whitelist' },
      { name: 'modpack', topic: 'Versione, modpack e resource pack del server' },
      { name: 'build', topic: 'Le tue build e i progetti della community' },
      { name: 'aiuto-tecnico', topic: 'Problemi di connessione, lag e crash' }
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
    name: '🎫 SUPPORTO',
    channels: [
      { name: 'apri-ticket', readOnly: true, topic: 'Apri un ticket con il pulsante qui sopra' }
    ]
  },
  {
    name: '🛠️ STAFF',
    private: true,
    channels: [
      { name: 'staff-chat', topic: 'Coordinamento dello staff' },
      { name: 'segnalazioni', topic: 'Segnalazioni dei membri' },
      { name: 'log-mod', topic: 'Log moderazione (auramen: /setup logs categoria:moderation)' },
      { name: 'log-ticket', topic: 'Log ticket (auramen: /setup logs categoria:ticket)' }
    ]
  },
  {
    name: '🔊 VOCALI',
    channels: [
      { name: 'Generale', type: 'voice' },
      { name: 'Minecraft', type: 'voice' },
      { name: 'Live & chill', type: 'voice' },
      { name: 'AFK', type: 'voice' }
    ]
  }
];

module.exports = { LINKS, ROLES, CATEGORIES };
