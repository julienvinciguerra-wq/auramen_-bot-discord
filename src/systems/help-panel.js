const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { BRAND_COLOR } = require('./tickets');

const DIVIDER = '───────────────';

/** Ordine dei pulsanti uguale al pannello: prima riga da 5, seconda con Personalizzazione. */
const SECTIONS = {
  help: {
    label: 'Help',
    style: ButtonStyle.Success,
    title: 'Hola!',
    body: [
      'Clicca su uno dei pulsanti qui sotto per ottenere informazioni su quella precisa categoria.',
      '',
      '**Comandi rapidi**',
      '`/help` apre questo pannello · `/ping` controlla se sono online',
      '',
      'Le risposte arrivano solo a te: il canale resta pulito.'
    ].join('\n')
  },
  info: {
    label: 'Info',
    style: ButtonStyle.Secondary,
    title: 'Info',
    body: [
      'auramen è un bot Discord open source per **ticket, moderazione, log, counter e giochi**.',
      '',
      'Sito del bot: https://auramen-bot-site.vercel.app',
      'Bio e social: https://auramen-site.vercel.app',
      'Invito: https://discord.com/oauth2/authorize?client_id=1550469997086642236&permissions=1099780189334&scope=bot%20applications.commands',
      '',
      'Ogni funzione si configura dal server, senza toccare il codice.'
    ].join('\n')
  },
  moderazione: {
    label: 'Moderazione',
    style: ButtonStyle.Primary,
    title: 'Moderazione',
    body: [
      '**Avvisi e storico**',
      '`/moderazione warn` — registra un avviso e avvisa il membro in privato',
      '`/moderazione storico` — ultimi provvedimenti di un utente',
      '`/moderazione annulla` — elimina un caso registrato per errore',
      '',
      '**Azioni**',
      '`/moderazione timeout` e `untimeout`',
      '`/moderazione kick`, `ban`, `unban`',
      '`/moderazione purge` — elimina fino a 100 messaggi recenti',
      '',
      'Ogni azione viene registrata nel canale log `moderazione`.'
    ].join('\n')
  },
  features: {
    label: 'Features',
    style: ButtonStyle.Success,
    title: 'Features',
    body: [
      '**Ticket** — pannello con pulsante, canale privato, claim, transcript HTML, riapertura ed eliminazione',
      '**Log** — membri, messaggi modificati ed eliminati, canali, ruoli, sanzioni, ticket, vocali',
      '**Counter** — canali vocali rinominati con membri, online o bot',
      '**Benvenuto** — messaggio automatico per i nuovi membri',
      '**Regole** — pubblica e aggiorna il regolamento con un comando',
      '**Conteggio** — gioco del counting con record salvato'
    ].join('\n')
  },
  giochi: {
    label: 'Giochi',
    style: ButtonStyle.Primary,
    title: 'Giochi',
    body: [
      '`/tris` — contro il bot (facile, media, difficile) o contro un membro',
      '`/rps-lizard-spock` — sasso, carta, forbici, lucertola, spock',
      '`/battleship` — battaglie navali 10×10 contro un membro',
      '`/counting setup` — conta in ordine, un errore azzera la serie',
      '`/toccalerba` — toc, esatto',
      '`/pong` — il classico'
    ].join('\n')
  },
  personalizzazione: {
    label: 'Personalizzazione',
    style: ButtonStyle.Danger,
    title: 'Personalizzazione',
    body: [
      '`/welcome setup` — canale, testo, colore, immagine e ruolo da pingare',
      '`/regole config` — titolo, testo, footer e colore del regolamento',
      '`/ticket config` — pannello, pulsante e messaggio di benvenuto del ticket',
      '`/ticket setup` — categoria, pannello, log, archivio transcript e ruoli staff',
      '`/setup logs` — assegna un canale a ogni categoria di log',
      '`/counter setup` — canali counter per membri, online e bot',
      '`/setup mostra` — rivedi tutta la configurazione salvata'
    ].join('\n')
  }
};

const ORDER = ['help', 'info', 'moderazione', 'features', 'giochi', 'personalizzazione'];

function buildSectionEmbed(key) {
  const section = SECTIONS[key];
  const divider = key === 'help' ? `\n${DIVIDER}\n` : `${DIVIDER}\n`;
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(section.title === 'Hola!' ? 'Help' : section.title)
    .setDescription(`${key === 'help' ? '' : `**${section.label}**\n`}${divider}${section.body}`)
    .setFooter({ text: 'Solo tu puoi vedere questo messaggio' });
}

function buildSectionComponents() {
  const buttons = ORDER.map(key => new ButtonBuilder()
    .setCustomId(`help:${key}`)
    .setLabel(SECTIONS[key].label)
    .setStyle(SECTIONS[key].style));

  return [
    new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
    new ActionRowBuilder().addComponents(buttons.slice(5))
  ];
}

/** Payload pronto: usato da /help e dall'aggiornamento dei pulsanti. */
function buildHelpView(key = 'help') {
  const section = SECTIONS[key] ? key : 'help';
  return {
    embeds: [buildSectionEmbed(section)],
    components: buildSectionComponents(),
    ephemeral: true
  };
}

/** Gestisce i pulsanti "help:…" del pannello. Ritorna false se il pulsante non è suo. */
async function handleHelpButton(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('help:')) return false;

  const key = customId.split(':')[1];
  const view = buildHelpView(key);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: view.embeds, components: view.components });
  } else {
    await interaction.update({ embeds: view.embeds, components: view.components });
  }
  return true;
}

module.exports = { SECTIONS, ORDER, DIVIDER, buildHelpView, buildSectionEmbed, handleHelpButton };
