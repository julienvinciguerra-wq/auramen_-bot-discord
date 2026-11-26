// Test dei giochi: solo logica pura, nessuna connessione a Discord.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auramen-games-')));

const games = require('../src/systems/games');
const counting = require('../src/systems/counting');

test('morra: ogni mossa batte esattamente due mosse', () => {
  for (const move of games.RPSLS_KEYS) {
    const wins = games.RPSLS_KEYS.filter(other => games.rpslsJudge(move, other).result === 'vittoria');
    assert.strictEqual(wins.length, 2, `${move} dovrebbe battere due mosse`);
  }

  assert.strictEqual(games.rpslsJudge('sasso', 'sasso').result, 'pareggio');
  assert.match(games.rpslsJudge('sasso', 'forbici').message, /Sasso schiaccia Forbici/);
  assert.match(games.rpslsJudge('carta', 'sasso').message, /Carta avvolge Sasso/);
  assert.match(games.rpslsJudge('lucertola', 'carta').message, /Lucertola mangia Carta/);
  assert.strictEqual(games.rpslsJudge('sasso', 'spock').result, 'sconfitta');
  assert.match(games.rpslsJudge('sasso', 'spock').message, /Spock vaporizza Sasso/);
  assert.throws(() => games.rpslsJudge('boh', 'sasso'), TypeError);
});

test('tris: vittorie, pareggio e mosse libere', () => {
  assert.strictEqual(games.tttWinner(['X', 'X', 'X', 'O', 'O', null, null, null, null]), 'X');
  assert.strictEqual(games.tttWinner(['O', 'O', 'O', 'X', 'X', null, null, null, 'X']), 'O');
  assert.strictEqual(games.tttWinner(['X', 'X', 'O', 'O', 'O', 'X', 'X', 'O', 'X']), 'pari');
  assert.strictEqual(games.tttWinner(games.createTttBoard()), null);
  assert.deepStrictEqual(games.tttFreeCells(['X', null, 'O', 'X', 'X', 'X', 'X', 'X', 'X']), [1]);
});

test('tris: difficoltà difficile vince e blocca, facile è casuale', () => {
  // Il bot (O) chiude su c2 con due pedine in fila.
  assert.strictEqual(games.tttBotMove(['O', 'O', null, 'X', 'X', null, null, null, null], 'difficile', { botSymbol: 'O' }), 2);

  // L'utente (X) minaccia su c3: il bot deve bloccare.
  assert.strictEqual(games.tttBotMove(['X', 'X', null, null, 'O', null, null, null, null], 'difficile', { botSymbol: 'O' }), 2);

  // Difficoltà facile: mossa casuale.
  assert.strictEqual(games.tttBotMove(['X', null, null, null, null, null, null, null, null], 'facile', { random: () => 0 }), 1);

  // Scacchiera piena: nessuna mossa.
  assert.strictEqual(games.tttBotMove(new Array(9).fill('X'), 'difficile'), null);
});

test('battaglie navali: flotta completa e senza sovrapposizioni', () => {
  const expectedCells = games.BATTLESHIP_SHIPS.reduce((total, ship) => total + ship.size, 0);

  for (let run = 0; run < 20; run++) {
    const fleet = games.placeFleet();
    assert.strictEqual(fleet.ships.length, games.BATTLESHIP_SHIPS.length);
    assert.strictEqual(fleet.occupancy.filter(Boolean).length, expectedCells);

    for (const ship of fleet.ships) {
      assert.strictEqual(ship.cells.length, ship.size);
      for (const cell of ship.cells) assert.strictEqual(fleet.occupancy[cell], ship.key);
    }

    const cells = fleet.ships.flatMap(ship => ship.cells);
    assert.strictEqual(new Set(cells).size, cells.length);
  }
});

test('battaglie navali: affondamento, riepilogo e griglia', () => {
  const ships = [{ key: 'pattugliatore', name: 'Pattugliatore', size: 2, cells: [0, 1] }];
  const occupancy = new Array(games.BOARD_CELLS).fill(null);
  occupancy[0] = 'pattugliatore';
  occupancy[1] = 'pattugliatore';

  assert.strictEqual(games.fleetDestroyed(ships, new Set([0])), false);
  assert.strictEqual(games.fleetDestroyed(ships, new Set([0, 1])), true);
  assert.strictEqual(games.fleetSummary(ships, new Set([0])), '1/1 navi in piedi');
  assert.strictEqual(games.fleetSummary(ships, new Set([0, 1])), '0/1 navi in piedi');
  assert.match(games.shipStatusLines(ships, new Set([0, 1]))[0], /affondata/);

  const lines = games.renderGrid({ occupancy, shots: new Set([0, 2]), revealShips: true }).split('\n');
  assert.strictEqual(lines.length, 11);
  assert.match(lines[1], /^A {2} x  #  o /);
  assert.strictEqual(games.cellLabel(0), 'A1');
  assert.strictEqual(games.cellLabel(99), 'J10');
});

test('conteggio: serie corretta, doppio turno, errore e record', async () => {
  const guildId = '333333333333333333';
  const channelId = '444444444444444444';
  counting.startCounting(guildId, channelId);

  function makeMessage(userId, content) {
    const message = {
      guild: { id: guildId },
      channelId,
      author: { id: userId, bot: false },
      content,
      system: false,
      reactions: [],
      replies: [],
      react: async emoji => { message.reactions.push(emoji); },
      reply: async text => { message.replies.push(text); }
    };
    return message;
  }

  await counting.handleCountingMessage(makeMessage('1', '1'));
  assert.strictEqual(counting.getCountingSettings(guildId).current, 1);
  assert.strictEqual(counting.getCountingSettings(guildId).lastUserId, '1');

  // Stesso utente due volte di fila: serie azzerata.
  const double = makeMessage('1', '2');
  await counting.handleCountingMessage(double);
  assert.strictEqual(counting.getCountingSettings(guildId).current, 0);
  assert.match(double.replies[0], /due volte di fila/);

  // Numero sbagliato.
  const wrong = makeMessage('2', '5');
  await counting.handleCountingMessage(wrong);
  assert.match(wrong.replies[0], /Il numero giusto era \*\*1\*\*/);

  // Testo non numerico: ignorato, nessuna risposta.
  const chat = makeMessage('2', 'ciao');
  await counting.handleCountingMessage(chat);
  assert.strictEqual(chat.replies.length, 0);
  assert.strictEqual(counting.getCountingSettings(guildId).current, 0);

  // Serie corretta: aggiorna numero e record.
  await counting.handleCountingMessage(makeMessage('2', '1'));
  await counting.handleCountingMessage(makeMessage('3', '2'));
  assert.strictEqual(counting.getCountingSettings(guildId).current, 2);
  assert.strictEqual(counting.getCountingSettings(guildId).best, 2);

  // Reset manuale: record conservato.
  counting.resetCounting(guildId);
  assert.strictEqual(counting.getCountingSettings(guildId).current, 0);
  assert.strictEqual(counting.getCountingSettings(guildId).best, 2);

  // Disattivazione: i messaggi non vengono più controllati.
  counting.stopCounting(guildId);
  const ignored = makeMessage('2', '1');
  await counting.handleCountingMessage(ignored);
  assert.strictEqual(ignored.reactions.length, 0);
});
