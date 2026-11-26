const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const { BRAND_COLOR } = require('./tickets');
const games = require('./games');

// Le partite vivono in memoria: nessun dato persistente, si azzerano al riavvio.
const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();
let sessionCounter = 0;

function createSession(data) {
  sessionCounter = (sessionCounter + 1) % 1000000;
  const id = `${Date.now().toString(36).slice(-5)}${sessionCounter.toString(36)}`;
  const session = { id, ...data };
  sessions.set(id, session);
  const timer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function endSession(session) {
  session.over = true;
  sessions.delete(session.id);
}

async function replyEphemeral(interaction, content) {
  const payload = { content, ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

function expired(interaction) {
  return replyEphemeral(interaction, 'Questa partita è scaduta: usa il comando per iniziarne una nuova.');
}

function challengePayload(interaction, session, { title, description }) {
  return {
    content: `<@${session.opponentId}>, ${interaction.user} ti ha sfidato.`,
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: 'La sfida scade dopo 15 minuti' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:accept:${session.id}`).setLabel('Accetta').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`game:decline:${session.id}`).setLabel('Rifiuta').setStyle(ButtonStyle.Secondary)
    )]
  };
}

// ---------------------------------------------------------------------------
// Tris
// ---------------------------------------------------------------------------

const TTT_SYMBOL = { X: '✕', O: '◯' };

function trisRows(session) {
  const rows = [];
  for (let row = 0; row < 3; row++) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 3; col++) {
      const index = row * 3 + col;
      const value = session.board[index];
      actionRow.addComponents(new ButtonBuilder()
        .setCustomId(`game:tris:${session.id}:${index}`)
        .setLabel(value ? TTT_SYMBOL[value] : '·')
        .setStyle(value === 'X' ? ButtonStyle.Danger : value === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(Boolean(session.over) || Boolean(value)));
    }
    rows.push(actionRow);
  }
  return rows;
}

function trisEmbed(session) {
  const lines = [];
  if (session.opponentId) {
    lines.push(`<@${session.playerId}> ✕ contro <@${session.opponentId}> ◯`);
    if (!session.over) lines.push(`Tocca a <@${session.turn === 'X' ? session.playerId : session.opponentId}> (${TTT_SYMBOL[session.turn]}).`);
  } else {
    lines.push(`<@${session.playerId}> ✕ contro **auramen bot** ◯ · difficoltà ${session.difficulty}`);
    if (!session.over) lines.push('Tocca a te: scegli una casella.');
  }
  if (session.note) lines.push('', session.note);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Tris')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'I pulsanti scadono dopo 15 minuti' });
}

async function startTris(interaction, { opponent = null, difficulty = 'difficile' } = {}) {
  const session = createSession({
    kind: 'tris',
    board: games.createTttBoard(),
    playerId: interaction.user.id,
    opponentId: opponent?.id ?? null,
    difficulty,
    turn: 'X',
    over: false,
    note: null
  });

  if (!opponent) {
    return interaction.reply({ embeds: [trisEmbed(session)], components: trisRows(session) });
  }

  return interaction.reply(challengePayload(interaction, session, {
    title: 'Sfida di tris',
    description: `**${interaction.user.username}** ha sfidato **${opponent.username}**.\nPremi **Accetta** per iniziare: le ✕ muovono per prime.`
  }));
}

function trisResultNote(session, result) {
  if (result === 'pari') return '🤝 Pareggio: la scacchiera è piena.';
  if (result === 'X') return `🏆 Vince <@${session.playerId}> (✕).`;
  return session.opponentId ? `🏆 Vince <@${session.opponentId}> (◯).` : '🏆 Vince il bot (◯).';
}

async function handleTrisClick(interaction, session, cell) {
  if (session.over) return replyEphemeral(interaction, 'La partita è finita: usa `/tris` per iniziarne una nuova.');
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return replyEphemeral(interaction, 'Casella non valida.');

  if (session.opponentId) {
    const isChallenger = interaction.user.id === session.playerId;
    const isOpponent = interaction.user.id === session.opponentId;
    if (!isChallenger && !isOpponent) return replyEphemeral(interaction, 'Questa partita non è tua: usa `/tris` per giocarne una.');
    const symbol = isChallenger ? 'X' : 'O';
    if (symbol !== session.turn) return replyEphemeral(interaction, 'Aspetta il tuo turno.');
  } else if (interaction.user.id !== session.playerId) {
    return replyEphemeral(interaction, 'Questa partita non è tua: usa `/tris` per giocarne una.');
  }

  if (session.board[cell]) return replyEphemeral(interaction, 'Cella già occupata.');

  session.board[cell] = session.turn;
  let result = games.tttWinner(session.board);

  if (!result && !session.opponentId) {
    const botCell = games.tttBotMove(session.board, session.difficulty, { botSymbol: 'O' });
    if (botCell !== null) session.board[botCell] = 'O';
    result = games.tttWinner(session.board);
  }

  if (result) {
    session.over = true;
    session.note = trisResultNote(session, result);
  } else {
    session.turn = session.turn === 'X' ? 'O' : 'X';
  }

  return interaction.update({ embeds: [trisEmbed(session)], components: trisRows(session) });
}

// ---------------------------------------------------------------------------
// Morra cinese estesa
// ---------------------------------------------------------------------------

function rpslsMoveRows(session) {
  const row = new ActionRowBuilder();
  for (const key of games.RPSLS_KEYS) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`game:rpsls:${session.id}:${key}`)
      .setLabel(games.RPSLS_MOVES[key].label)
      .setEmoji(games.RPSLS_MOVES[key].emoji)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(session.over)));
  }
  return [row];
}

function rpslsMenuEmbed(session) {
  const lines = session.opponentId
    ? [`<@${session.playerId}> sfida <@${session.opponentId}>: scegliete la vostra mossa.`, 'Ogni scelta resta nascosta finché non hanno scelto entrambi.']
    : [`<@${session.playerId}> contro **auramen bot**: scegli la tua mossa.`, ''];

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Morra cinese estesa')
    .setDescription(`${lines.join('\n')}\nSasso · Carta · Forbici · Lucertola · Spock`);
}

function rpslsRulesEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Regole: Sasso · Carta · Forbici · Lucertola · Spock')
    .setDescription(games.RPSLS_RULES.map(rule => `• ${rule}`).join('\n'));
}

function rpslsResultEmbed(session, userMove, enemyMove, verdict) {
  const winner = verdict.result === 'vittoria'
    ? `<@${session.playerId}>`
    : session.opponentId
      ? `<@${session.opponentId}>`
      : '**auramen bot**';

  const lines = [
    `<@${session.playerId}>: ${games.RPSLS_MOVES[userMove].emoji} ${games.RPSLS_MOVES[userMove].label}`,
    `${session.opponentId ? `<@${session.opponentId}>` : '**auramen bot**'}: ${games.RPSLS_MOVES[enemyMove].emoji} ${games.RPSLS_MOVES[enemyMove].label}`,
    '',
    verdict.message
  ];
  lines.push(verdict.result === 'pareggio' ? '🤝 Pareggio.' : `🏆 Vince ${winner}.`);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Morra cinese estesa')
    .setDescription(lines.join('\n'));
}

async function startRpsls(interaction, { opponent = null, rules = false } = {}) {
  const session = createSession({
    kind: 'rpsls',
    playerId: interaction.user.id,
    opponentId: opponent?.id ?? null,
    picks: {},
    over: false
  });

  const payload = opponent
    ? challengePayload(interaction, session, {
      title: 'Sfida di morra cinese estesa',
      description: `**${interaction.user.username}** ha sfidato **${opponent.username}**.\nPremi **Accetta** e scegliete in segreto la vostra mossa.`
    })
    : { embeds: [rpslsMenuEmbed(session)], components: rpslsMoveRows(session) };

  if (!rules) return interaction.reply(payload);

  await interaction.reply({ embeds: [rpslsRulesEmbed()], ephemeral: true });
  return interaction.followUp(payload);
}

async function handleRpslsPick(interaction, session, move) {
  if (session.over) return replyEphemeral(interaction, 'La partita è finita: usa `/rps-lizard-spock` per giocarne una nuova.');
  if (!games.RPSLS_MOVES[move]) return replyEphemeral(interaction, 'Mossa non valida.');

  const isChallenger = interaction.user.id === session.playerId;
  const isOpponent = session.opponentId && interaction.user.id === session.opponentId;
  if (!isChallenger && !isOpponent) return replyEphemeral(interaction, 'Questa partita non è tua: usa `/rps-lizard-spock` per giocarne una.');

  const slot = isChallenger ? 'challenger' : 'opponent';
  if (session.picks[slot]) return replyEphemeral(interaction, 'Hai già scelto: attendi l’avversario.');

  if (!session.opponentId) {
    const enemyMove = games.rpslsRandomMove();
    const verdict = games.rpslsJudge(move, enemyMove);
    session.over = true;
    return interaction.update({ embeds: [rpslsResultEmbed(session, move, enemyMove, verdict)], components: [] });
  }

  session.picks[slot] = move;
  if (!session.picks.challenger || !session.picks.opponent) {
    return replyEphemeral(interaction, `Scelta registrata: ${games.RPSLS_MOVES[move].emoji} ${games.RPSLS_MOVES[move].label}. Attendo l’avversario.`);
  }

  const verdict = games.rpslsJudge(session.picks.challenger, session.picks.opponent);
  session.over = true;
  return interaction.update({ embeds: [rpslsResultEmbed(session, session.picks.challenger, session.picks.opponent, verdict)], components: [] });
}

// ---------------------------------------------------------------------------
// Battaglie navali
// ---------------------------------------------------------------------------

const ROWS_PER_PAGE = 2;
const BATTLESHIP_PAGES = games.BOARD_SIZE / ROWS_PER_PAGE;

function otherSide(side) {
  return side === 'A' ? 'B' : 'A';
}

function battleshipPage(session, page) {
  const shots = session.shots[session.turn];
  let safe = ((page % BATTLESHIP_PAGES) + BATTLESHIP_PAGES) % BATTLESHIP_PAGES;

  for (let attempt = 0; attempt < BATTLESHIP_PAGES; attempt++) {
    const start = safe * ROWS_PER_PAGE * games.BOARD_SIZE;
    const cells = [];
    for (let index = start; index < start + ROWS_PER_PAGE * games.BOARD_SIZE; index++) {
      if (!shots.has(index)) cells.push(index);
    }
    if (cells.length) return { cells, page: safe };
    safe = (safe + 1) % BATTLESHIP_PAGES;
  }

  return { cells: [], page: 0 };
}

function battleshipRows(session) {
  const current = battleshipPage(session, session.page || 0);
  session.page = current.page;
  const first = current.cells[0];
  const last = current.cells[current.cells.length - 1];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`game:bsshoot:${session.id}`)
    .setPlaceholder(current.cells.length
      ? `Spara · pagina ${current.page + 1}/${BATTLESHIP_PAGES} (${games.cellLabel(first)}–${games.cellLabel(last)})`
      : 'Nessuna cella libera')
    .addOptions(current.cells.length
      ? current.cells.map(cell => new StringSelectMenuOptionBuilder()
        .setLabel(games.cellLabel(cell))
        .setValue(String(cell)))
      : [new StringSelectMenuOptionBuilder().setLabel('Nessuna cella libera').setValue('none')]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game:bsfleet:${session.id}`).setLabel('La mia flotta').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`game:bspage:${session.id}:prev`).setLabel('◀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`game:bspage:${session.id}:next`).setLabel('▶').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`game:bsresign:${session.id}`).setLabel('Resa').setStyle(ButtonStyle.Danger)
  );

  return [new ActionRowBuilder().addComponents(select), buttons];
}

function battleshipEmbed(session) {
  const a = session.players.A;
  const b = session.players.B;
  const lines = [
    `**Tiri di <@${a.id}>**`,
    '```',
    games.renderGrid({ occupancy: b.fleet.occupancy, shots: session.shots.A }),
    '```',
    `**Tiri di <@${b.id}>**`,
    '```',
    games.renderGrid({ occupancy: a.fleet.occupancy, shots: session.shots.B }),
    '```',
    `**Flotta di <@${a.id}>**: ${games.fleetSummary(a.fleet.ships, session.shots.B)}`,
    `**Flotta di <@${b.id}>**: ${games.fleetSummary(b.fleet.ships, session.shots.A)}`
  ];
  if (session.note) lines.push('', session.note);
  if (!session.over) lines.push('', `Tocca a <@${session.players[session.turn].id}>.`);

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Battaglie navali')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Legenda: · mai colpita, o acqua, x colpita' });
}

function fleetText(session, side) {
  const fleet = session.players[side].fleet;
  const hits = session.shots[otherSide(side)];
  return [
    '**La tua flotta** (le posizioni restano segrete all’avversario)',
    '```',
    games.renderGrid({ occupancy: fleet.occupancy, shots: hits, revealShips: true }),
    '```',
    ...games.shipStatusLines(fleet.ships, hits),
    '',
    'Legenda: # nave intatta, x colpita, o acqua.'
  ].join('\n');
}

async function startBattleship(interaction, opponent) {
  const session = createSession({
    kind: 'battleship',
    playerId: interaction.user.id,
    opponentId: opponent.id,
    challengerInteraction: interaction,
    players: {
      A: { id: interaction.user.id, fleet: null },
      B: { id: opponent.id, fleet: null }
    },
    shots: { A: new Set(), B: new Set() },
    turn: 'A',
    page: 0,
    started: false,
    over: false,
    note: null
  });

  return interaction.reply(challengePayload(interaction, session, {
    title: 'Sfida di battaglie navali',
    description: `**${interaction.user.username}** ha sfidato **${opponent.username}**.\nPremi **Accetta** per iniziare: le flotte vengono schierate automaticamente e restano segrete, ognuno vede solo i propri tiri.`
  }));
}

async function pushFleet(interaction, session, side) {
  if (!interaction?.followUp) return;
  await interaction.followUp({ content: fleetText(session, side), ephemeral: true }).catch(() => {});
}

async function startBattleshipBattle(interaction, session) {
  session.players.A.fleet = games.placeFleet();
  session.players.B.fleet = games.placeFleet();
  session.started = true;
  session.turn = 'A';

  await interaction.update({
    content: null,
    embeds: [battleshipEmbed(session)],
    components: battleshipRows(session)
  });

  // Le flotte sono riservate: ognuno riceve la propria in un messaggio privato.
  await pushFleet(session.challengerInteraction, session, 'A');
  await pushFleet(interaction, session, 'B');
}

async function handleBattleshipShot(interaction, session, cell) {
  if (!session.started) return replyEphemeral(interaction, 'La sfida non è ancora stata accettata.');
  if (session.over) return replyEphemeral(interaction, 'La partita è finita: usa `/battleship` per iniziarne una nuova.');

  const side = session.turn;
  const playerId = session.players[side].id;
  if (interaction.user.id !== playerId) return replyEphemeral(interaction, 'Non è il tuo turno.');

  if (!Number.isInteger(cell) || cell < 0 || cell >= games.BOARD_CELLS) return replyEphemeral(interaction, 'Cella non valida.');
  if (session.shots[side].has(cell)) return replyEphemeral(interaction, 'Hai già sparato lì.');

  const enemySide = otherSide(side);
  const enemyFleet = session.players[enemySide].fleet;
  const hit = Boolean(enemyFleet.occupancy[cell]);
  session.shots[side].add(cell);

  const parts = [`${hit ? '💥' : '💧'} **${games.cellLabel(cell)}**: ${hit ? 'colpito' : 'acqua'}.`];
  if (hit) {
    const ship = enemyFleet.ships.find(item => item.cells.includes(cell));
    if (ship && ship.cells.every(shipCell => session.shots[side].has(shipCell))) {
      parts.push(`☠️ **${ship.name}** di <@${session.players[enemySide].id}> affondata.`);
    }
  }

  if (games.fleetDestroyed(enemyFleet.ships, session.shots[side])) {
    session.over = true;
    session.note = `🏆 <@${playerId}> ha affondato tutta la flotta avversaria.`;
  } else {
    session.turn = enemySide;
    session.page = 0;
    session.note = parts.join(' ');
  }

  return interaction.update({ embeds: [battleshipEmbed(session)], components: battleshipRows(session) });
}

// ---------------------------------------------------------------------------
// Gestione comuni: accettazione, rifiuto, inoltro dei click
// ---------------------------------------------------------------------------

async function handleAccept(interaction, session) {
  if (interaction.user.id !== session.opponentId) return replyEphemeral(interaction, 'Questa sfida non è per te.');
  if (session.started) return replyEphemeral(interaction, 'La sfida è già stata accettata.');

  if (session.kind === 'tris') {
    session.started = true;
    return interaction.update({ content: null, embeds: [trisEmbed(session)], components: trisRows(session) });
  }
  if (session.kind === 'rpsls') {
    session.started = true;
    return interaction.update({ content: null, embeds: [rpslsMenuEmbed(session)], components: rpslsMoveRows(session) });
  }
  if (session.kind === 'battleship') return startBattleshipBattle(interaction, session);
  return replyEphemeral(interaction, 'Sfida non riconosciuta.');
}

async function handleDecline(interaction, session) {
  if (interaction.user.id !== session.opponentId) return replyEphemeral(interaction, 'Questa sfida non è per te.');
  endSession(session);
  return interaction.update({
    content: null,
    embeds: [new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setDescription(`Sfida rifiutata da <@${interaction.user.id}>.`)],
    components: []
  });
}

/**
 * Gestisce i componenti dei giochi. Ritorna true se l'interazione era sua,
 * così index.js può passare agli altri gestori solo ciò che non le appartiene.
 */
async function handleGameInteraction(interaction) {
  const customId = interaction.customId || '';
  if (!customId.startsWith('game:')) return false;

  const [, action, sessionId, extra] = customId.split(':');
  const session = getSession(sessionId);
  if (!session) {
    await expired(interaction);
    return true;
  }

  try {
    if (action === 'accept') await handleAccept(interaction, session);
    else if (action === 'decline') await handleDecline(interaction, session);
    else if (action === 'tris') await handleTrisClick(interaction, session, Number(extra));
    else if (action === 'rpsls') await handleRpslsPick(interaction, session, extra);
    else if (action === 'bsshoot') {
      if (!interaction.isStringSelectMenu()) return true;
      await handleBattleshipShot(interaction, session, Number(interaction.values?.[0]));
    } else if (action === 'bsfleet') {
      await replyEphemeral(interaction, fleetText(session, interaction.user.id === session.players.B.id ? 'B' : 'A'));
    } else if (action === 'bspage') {
      if (!session.started || session.over) return true;
      const step = extra === 'prev' ? -1 : 1;
      session.page = (session.page || 0) + step;
      await interaction.update({ embeds: [battleshipEmbed(session)], components: battleshipRows(session) });
    } else if (action === 'bsresign') {
      if (session.over) return true;
      const side = interaction.user.id === session.players.A.id ? 'A' : interaction.user.id === session.players.B.id ? 'B' : null;
      if (!side) {
        await replyEphemeral(interaction, 'Non stai giocando questa partita.');
        return true;
      }
      session.over = true;
      session.note = `🏳️ <@${interaction.user.id}> si è arreso: vince <@${session.players[otherSide(side)].id}>.`;
      await interaction.update({ embeds: [battleshipEmbed(session)], components: [] });
    }
  } catch (error) {
    console.error(`Errore gioco (${customId}):`, error);
    await replyEphemeral(interaction, 'Mossa non riuscita: riprova.');
  }

  return true;
}

module.exports = {
  startTris,
  startRpsls,
  startBattleship,
  handleGameInteraction
};
