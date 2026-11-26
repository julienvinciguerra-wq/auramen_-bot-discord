const test = require('node:test');
const assert = require('node:assert');

const { buildHelpView, SECTIONS, ORDER } = require('../src/systems/help-panel');

test('il pannello help ha le sei sezioni nell\'ordine del design', () => {
  assert.deepEqual(ORDER, ['help', 'info', 'moderazione', 'features', 'giochi', 'personalizzazione']);
  assert.deepEqual(ORDER.map(key => SECTIONS[key].label), [
    'Help', 'Info', 'Moderazione', 'Features', 'Giochi', 'Personalizzazione'
  ]);
});

test('i pulsanti stanno su due righe come nello screen', () => {
  const view = buildHelpView();
  const rows = view.components.map(row => row.toJSON());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].components.length, 5);
  assert.equal(rows[1].components.length, 1);
  assert.deepEqual(
    rows.flatMap(row => row.components.map(button => button.custom_id)),
    ORDER.map(key => `help:${key}`)
  );
  assert.equal(rows[1].components[0].label, 'Personalizzazione');
});

test('ogni pulsante ha uno stile Discord valido', () => {
  for (const key of ORDER) {
    assert.ok([1, 2, 3, 4].includes(SECTIONS[key].style), `stile non valido per ${key}`);
    assert.ok(SECTIONS[key].label.length <= 80);
    assert.ok(SECTIONS[key].body.length <= 3500, `testo troppo lungo per ${key}`);
  }
});

test('l\'embed rispetta i limiti e la vista resta effimera', () => {
  for (const key of ORDER) {
    const view = buildHelpView(key);
    const embed = view.embeds[0].toJSON();
    assert.ok(embed.title.length <= 256);
    assert.ok(embed.description.length <= 4096);
    assert.equal(view.ephemeral, true);
  }
});

test('una sezione sconosciuta ricade su help', () => {
  const view = buildHelpView('inesistente');
  assert.equal(view.embeds[0].toJSON().title, 'Help');
});
