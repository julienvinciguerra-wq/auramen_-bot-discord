const test = require('node:test');
const assert = require('node:assert/strict');

const { renderWelcomeText, DEFAULT_WELCOME } = require('../src/systems/welcome');

test('i segnaposto del benvenuto vengono sostituiti', () => {
  const text = renderWelcomeText('Ciao {user} ({name}), {server} è a {count} membri!', {
    user: '<@1>',
    name: 'Mario',
    server: 'auramen',
    count: 65
  });
  assert.equal(text, 'Ciao <@1> (Mario), auramen è a 65 membri!');
});

test('il testo predefinito contiene utente e conteggio', () => {
  assert.match(DEFAULT_WELCOME.message, /\{user\}/);
  assert.match(DEFAULT_WELCOME.message, /\{count\}/);
});
