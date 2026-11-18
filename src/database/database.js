const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'auramen.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT UNIQUE,
    opener_id TEXT NOT NULL,
    claimed_by TEXT,
    transferred_to TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
  );
`);

// --- Migrazioni additive (non modificano né eliminano dati esistenti) ---
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(col => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('tickets', 'closed_by', 'TEXT');
ensureColumn('tickets', 'reopened_at', 'TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_opener ON tickets (guild_id, opener_id, status);
`);

const getConfigStmt = db.prepare('SELECT config_json FROM guild_config WHERE guild_id = ?');
const setConfigStmt = db.prepare(`
  INSERT INTO guild_config (guild_id, config_json, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(guild_id) DO UPDATE SET
    config_json = excluded.config_json,
    updated_at = CURRENT_TIMESTAMP
`);

function getGuildConfig(guildId) {
  const row = getConfigStmt.get(guildId);
  if (!row) return {};
  try { return JSON.parse(row.config_json); } catch { return {}; }
}

function setGuildConfig(guildId, config) {
  setConfigStmt.run(guildId, JSON.stringify(config));
}

module.exports = { db, getGuildConfig, setGuildConfig };
