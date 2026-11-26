// Logica pura dei giochi: nessuna dipendenza da Discord, così è verificabile
// con node:test (vedi tests/games.test.js).

// ---------------------------------------------------------------------------
// Morra cinese estesa (Rock Paper Scissors Lizard Spock)
// ---------------------------------------------------------------------------

const RPSLS_MOVES = {
  sasso: { label: 'Sasso', emoji: '🪨' },
  carta: { label: 'Carta', emoji: '📄' },
  forbici: { label: 'Forbici', emoji: '✂️' },
  lucertola: { label: 'Lucertola', emoji: '🦎' },
  spock: { label: 'Spock', emoji: '🖖' }
};

const RPSLS_BEATS = {
  forbici: { carta: 'taglia', lucertola: 'decapita' },
  carta: { sasso: 'avvolge', spock: 'confuta' },
  sasso: { lucertola: 'schiaccia', forbici: 'schiaccia' },
  lucertola: { spock: 'avvelena', carta: 'mangia' },
  spock: { forbici: 'distrugge', sasso: 'vaporizza' }
};

const RPSLS_RULES = [
  'Forbici tagliano Carta e decapitano Lucertola',
  'Carta avvolge Sasso e confuta Spock',
  'Sasso schiaccia Lucertola e Forbici',
  'Lucertola avvelena Spock e mangia Carta',
  'Spock distrugge Forbici e vaporizza Sasso'
];

const RPSLS_KEYS = Object.keys(RPSLS_MOVES);

function rpslsLabel(move) {
  return RPSLS_MOVES[move]?.label || String(move);
}

function rpslsRandomMove(random = Math.random) {
  return RPSLS_KEYS[Math.floor(random() * RPSLS_KEYS.length)];
}

/** Esito della mano: { result: 'vittoria' | 'sconfitta' | 'pareggio', message }. */
function rpslsJudge(user, enemy) {
  if (!RPSLS_MOVES[user]) throw new TypeError(`Mossa non valida: ${user}`);
  if (!RPSLS_MOVES[enemy]) throw new TypeError(`Mossa non valida: ${enemy}`);
  if (user === enemy) {
    return { result: 'pareggio', message: `Pareggio: ${rpslsLabel(user)} contro ${rpslsLabel(enemy)}.` };
  }
  const verb = RPSLS_BEATS[user]?.[enemy];
  if (verb) return { result: 'vittoria', message: `${rpslsLabel(user)} ${verb} ${rpslsLabel(enemy)}.` };
  const reverse = RPSLS_BEATS[enemy]?.[user] || 'batte';
  return { result: 'sconfitta', message: `${rpslsLabel(enemy)} ${reverse} ${rpslsLabel(user)}.` };
}

// ---------------------------------------------------------------------------
// Tris
// ---------------------------------------------------------------------------

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function createTttBoard() {
  return new Array(9).fill(null);
}

function tttFreeCells(board) {
  const free = [];
  for (let index = 0; index < 9; index++) if (!board[index]) free.push(index);
  return free;
}

/** 'X', 'O', 'pari' oppure null se la partita continua. */
function tttWinner(board) {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return tttFreeCells(board).length ? null : 'pari';
}

function tttMinimax(board, turn, botSymbol, humanSymbol, depth) {
  const result = tttWinner(board);
  if (result === botSymbol) return 10 - depth;
  if (result === humanSymbol) return depth - 10;
  if (result === 'pari') return 0;

  const scores = tttFreeCells(board).map(cell => {
    board[cell] = turn;
    const score = tttMinimax(board, turn === botSymbol ? humanSymbol : botSymbol, botSymbol, humanSymbol, depth + 1);
    board[cell] = null;
    return score;
  });

  return turn === botSymbol ? Math.max(...scores) : Math.min(...scores);
}

/** Tutte le mosse che massimizzano il risultato per il bot. */
function tttBestMoves(board, botSymbol) {
  const humanSymbol = botSymbol === 'X' ? 'O' : 'X';
  let best = -Infinity;
  let bestCells = [];

  for (const cell of tttFreeCells(board)) {
    board[cell] = botSymbol;
    const score = tttMinimax(board, humanSymbol, botSymbol, humanSymbol, 1);
    board[cell] = null;
    if (score > best) {
      best = score;
      bestCells = [cell];
    } else if (score === best) {
      bestCells.push(cell);
    }
  }

  return bestCells;
}

/**
 * Mossa del bot: facile = a caso, media = quasi sempre perfetta,
 * difficile = sempre perfetta. Ritorna null se la scacchiera è piena.
 */
function tttBotMove(board, difficulty = 'difficile', { random = Math.random, botSymbol = 'O' } = {}) {
  const free = tttFreeCells(board);
  if (!free.length) return null;

  const level = String(difficulty || 'difficile').toLowerCase();
  if (level === 'facile' || level === 'easy') return free[Math.floor(random() * free.length)];

  const best = tttBestMoves([...board], botSymbol);
  if (level === 'media' || level === 'medium') {
    if (random() < 0.75) return best[Math.floor(random() * best.length)];
    const alternatives = free.filter(cell => !best.includes(cell));
    return alternatives.length ? alternatives[Math.floor(random() * alternatives.length)] : best[0];
  }

  return best[Math.floor(random() * best.length)];
}

// ---------------------------------------------------------------------------
// Battaglie navali
// ---------------------------------------------------------------------------

const BOARD_SIZE = 10;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const COLUMN_LETTERS = 'ABCDEFGHIJ';

const BATTLESHIP_SHIPS = [
  { key: 'portaerei', name: 'Portaerei', size: 5 },
  { key: 'corazzata', name: 'Corazzata', size: 4 },
  { key: 'incrociatore', name: 'Incrociatore', size: 3 },
  { key: 'sottomarino', name: 'Sottomarino', size: 3 },
  { key: 'pattugliatore', name: 'Pattugliatore', size: 2 }
];

function cellLabel(index) {
  if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) {
    throw new RangeError(`Cella non valida: ${index}`);
  }
  return `${COLUMN_LETTERS[Math.floor(index / BOARD_SIZE)]}${(index % BOARD_SIZE) + 1}`;
}

/**
 * Schiera la flotta a caso senza sovrapposizioni.
 * Ritorna { ships: [{ key, name, size, cells }], occupancy: Array(100) } dove
 * occupancy[i] è la chiave della nave che occupa la cella i (oppure null).
 */
function placeFleet(random = Math.random) {
  const occupancy = new Array(BOARD_CELLS).fill(null);
  const ships = [];

  for (const spec of BATTLESHIP_SHIPS) {
    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const horizontal = random() < 0.5;
      const row = Math.floor(random() * BOARD_SIZE);
      const col = Math.floor(random() * BOARD_SIZE);
      const cells = [];

      for (let step = 0; step < spec.size; step++) {
        const r = horizontal ? row : row + step;
        const c = horizontal ? col + step : col;
        if (r >= BOARD_SIZE || c >= BOARD_SIZE) break;
        cells.push(r * BOARD_SIZE + c);
      }

      if (cells.length !== spec.size) continue;
      if (cells.some(cell => occupancy[cell])) continue;

      for (const cell of cells) occupancy[cell] = spec.key;
      ships.push({ ...spec, cells });
      placed = true;
    }

    // Con 200 tentativi la probabilità di fallire è trascurabile: si riparte da zero.
    if (!placed) return placeFleet(random);
  }

  return { ships, occupancy };
}

function fleetDestroyed(ships, shots) {
  return ships.every(ship => ship.cells.every(cell => shots.has(cell)));
}

function fleetSummary(ships, shots) {
  const alive = ships.filter(ship => !ship.cells.every(cell => shots.has(cell))).length;
  return `${alive}/${ships.length} navi in piedi`;
}

function shipStatusLines(ships, shots) {
  return ships.map(ship => {
    const hits = ship.cells.filter(cell => shots.has(cell)).length;
    if (hits === ship.size) return `☠️ ${ship.name} affondata`;
    return `🚢 ${ship.name} (${ship.size}) — colpi ${hits}/${ship.size}`;
  });
}

/**
 * Scacchiera in blocco di codice: '·' mai colpita, 'o' acqua, 'x' colpita,
 * '#' nave (solo con revealShips).
 */
function renderGrid({ occupancy = null, shots = new Set(), revealShips = false } = {}) {
  const header = `   ${Array.from({ length: BOARD_SIZE }, (_, index) => String(index + 1).padStart(3)).join('')}`;
  const lines = [header];

  for (let row = 0; row < BOARD_SIZE; row++) {
    let line = `${COLUMN_LETTERS[row]}  `;
    for (let col = 0; col < BOARD_SIZE; col++) {
      const index = row * BOARD_SIZE + col;
      let symbol = '·';
      if (shots.has(index)) symbol = occupancy?.[index] ? 'x' : 'o';
      else if (revealShips && occupancy?.[index]) symbol = '#';
      line += ` ${symbol} `;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

module.exports = {
  RPSLS_MOVES,
  RPSLS_RULES,
  RPSLS_KEYS,
  rpslsLabel,
  rpslsRandomMove,
  rpslsJudge,
  createTttBoard,
  tttFreeCells,
  tttWinner,
  tttBotMove,
  BOARD_SIZE,
  BOARD_CELLS,
  BATTLESHIP_SHIPS,
  cellLabel,
  placeFleet,
  fleetDestroyed,
  fleetSummary,
  shipStatusLines,
  renderGrid
};
