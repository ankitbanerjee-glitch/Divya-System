const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const TABLES = new Set(['events', 'work_orders', 'tickets', 'dispatches']);

class JsonStore {
  constructor() { this.file = process.env.DATA_FILE || path.join(__dirname, 'data', 'runtime.json'); }
  async init() { try { await fs.access(this.file); } catch { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify({ events: [], work_orders: [], tickets: [], dispatches: [] }, null, 2)); } }
  async read() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async health() { await fs.access(this.file); }
  async list(table, limit) { if (!TABLES.has(table)) throw new Error('Invalid table'); const data = await this.read(); return data[table].slice(-Math.min(Math.max(limit, 1), 500)).reverse(); }
  async create(table, values) { if (!TABLES.has(table)) throw new Error('Invalid table'); const data = await this.read(); const item = { id: crypto.randomUUID(), ...values, createdAt: new Date().toISOString() }; data[table].push(item); await fs.writeFile(this.file, JSON.stringify(data, null, 2)); return item; }
}

class MongoStore {
  constructor(connectionString) {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 10_000 });
  }
  async init() {
    await this.client.connect();
    this.db = this.client.db(process.env.MONGODB_DB || 'divya_system');
    await Promise.all([...TABLES].map((name) => this.db.collection(name).createIndex({ createdAt: -1 })));
    await this.db.collection('events').createIndex({ moduleId: 1, status: 1 });
  }
  collection(table) {
    if (!TABLES.has(table)) throw new Error('Invalid collection');
    return this.db.collection(table);
  }
  async health() { await this.db.command({ ping: 1 }); }
  async list(table, limit) {
    return this.collection(table).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 500)).toArray();
  }
  async create(table, values) {
    const item = { id: crypto.randomUUID(), ...values, createdAt: new Date() };
    await this.collection(table).insertOne(item);
    return { ...item, createdAt: item.createdAt.toISOString() };
  }
}
function createStore() { return process.env.MONGODB_URI ? new MongoStore(process.env.MONGODB_URI) : new JsonStore(); }
module.exports = { createStore };
