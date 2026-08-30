const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const TABLES = new Set(['events', 'work_orders', 'tickets', 'dispatches']);
const toSnake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const toCamel = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const normalize = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamel(key), value]));

class JsonStore {
  constructor() { this.file = process.env.DATA_FILE || path.join(__dirname, 'data', 'runtime.json'); }
  async init() { try { await fs.access(this.file); } catch { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify({ events: [], work_orders: [], tickets: [], dispatches: [] }, null, 2)); } }
  async read() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async health() { await fs.access(this.file); }
  async list(table, limit) { if (!TABLES.has(table)) throw new Error('Invalid table'); const data = await this.read(); return data[table].slice(-Math.min(Math.max(limit, 1), 500)).reverse(); }
  async create(table, values) { if (!TABLES.has(table)) throw new Error('Invalid table'); const data = await this.read(); const item = { id: crypto.randomUUID(), ...values, createdAt: new Date().toISOString() }; data[table].push(item); await fs.writeFile(this.file, JSON.stringify(data, null, 2)); return item; }
}

class PostgresStore {
  constructor(connectionString) { const { Pool } = require('pg'); this.pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined }); }
  async init() { await this.pool.query(`CREATE TABLE IF NOT EXISTS events (id UUID PRIMARY KEY, module_id TEXT NOT NULL, ip TEXT, event_type TEXT NOT NULL, severity TEXT, voltage DOUBLE PRECISION, details TEXT, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS work_orders (id UUID PRIMARY KEY, network_id TEXT NOT NULL, type TEXT NOT NULL, scheduled_date TEXT NOT NULL, technician TEXT NOT NULL, notes TEXT, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS tickets (id UUID PRIMARY KEY, subject TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, network_id TEXT, description TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS dispatches (id UUID PRIMARY KEY, network_id TEXT NOT NULL, dispatcher TEXT NOT NULL, memo TEXT, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`); }
  async health() { await this.pool.query('SELECT 1'); }
  async list(table, limit) { if (!TABLES.has(table)) throw new Error('Invalid table'); const result = await this.pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]); return result.rows.map(normalize); }
  async create(table, values) { if (!TABLES.has(table)) throw new Error('Invalid table'); const keys = Object.keys(values).map(toSnake), params = Object.values(values), placeholders = params.map((_, i) => `$${i + 2}`); const result = await this.pool.query(`INSERT INTO ${table} (id, ${keys.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING *`, [crypto.randomUUID(), ...params]); return normalize(result.rows[0]); }
}
function createStore() { return process.env.DATABASE_URL ? new PostgresStore(process.env.DATABASE_URL) : new JsonStore(); }
module.exports = { createStore };
