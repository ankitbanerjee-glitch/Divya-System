const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadLocalEnvironment();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });

const DATA_DIR = process.env.DIVYA_DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'runtime.json');
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'divya_system';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = IS_PRODUCTION ? '__Host-divya_session' : 'divya_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

if (IS_PRODUCTION) {
  const required = ['MONGODB_URI', 'DIVYA_ADMIN_USER', 'DIVYA_ADMIN_PASSWORD', 'DIVYA_USER_USER', 'DIVYA_USER_PASSWORD'];
  const missing = required.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
  if (process.env.DIVYA_ADMIN_PASSWORD === 'DivyaAdmin@2026' || process.env.DIVYA_USER_PASSWORD === 'DivyaUser@2026') {
    throw new Error('Default demonstration passwords cannot be used in production.');
  }
}

const accounts = [
  {
    id: 'admin-01', role: 'admin', name: 'Grid Administrator',
    username: process.env.DIVYA_ADMIN_USER || 'admin',
    password: process.env.DIVYA_ADMIN_PASSWORD || 'DivyaAdmin@2026'
  },
  {
    id: 'user-01', role: 'user', name: 'Monitoring User',
    username: process.env.DIVYA_USER_USER || 'user',
    password: process.env.DIVYA_USER_PASSWORD || 'DivyaUser@2026'
  }
];

const defaultModules = readJson(path.join(__dirname, 'data', 'modules.json'), []);
const defaultEngineers = readJson(path.join(__dirname, 'data', 'engineers.json'), []);
let modules = defaultModules;
let engineers = defaultEngineers;
let runtime = readJson(STATE_FILE, {
  events: [],
  workOrders: [],
  tickets: [],
  updatedAt: new Date().toISOString()
});
let writeQueue = Promise.resolve();
let mongoClient = null;
let runtimeCollection = null;
let databaseStatus = { mode: 'json', connected: false, name: null, error: null };

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return structuredClone(fallback);
  }
}

function clean(value, max = 240) {
  return String(value ?? '').trim().replace(/[<>]/g, '').slice(0, max);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionForRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function publicUser(session) {
  return session ? { id: session.id, name: session.name, username: session.username, role: session.role } : null;
}

function publicDatabaseStatus() {
  return { mode: databaseStatus.mode, connected: databaseStatus.connected, name: databaseStatus.name };
}

function requireAuth(req, res, next) {
  const session = sessionForRequest(req);
  if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function findModule(query = {}) {
  const requested = clean(query.nodeId || query.moduleCode || query.ip, 80).toLowerCase();
  if (!requested) return null;
  return modules.find((module) =>
    [module.nodeId, module.moduleCode, module.ip].some((value) =>
      String(value || '').toLowerCase() === requested
    )
  ) || null;
}

function distanceKm(a, b) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestEngineer(module) {
  if (!module || !Number.isFinite(Number(module.lat)) || !Number.isFinite(Number(module.lng))) return null;
  const available = engineers.filter((engineer) => engineer.status !== 'Off Duty');
  return available
    .map((engineer) => ({ ...engineer, distanceKm: Number(distanceKm(module, engineer).toFixed(1)) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
}

function persistRuntime() {
  runtime.updatedAt = new Date().toISOString();
  if (runtimeCollection) {
    writeQueue = writeQueue.catch(() => {}).then(() => runtimeCollection.updateOne(
      { _id: 'console-runtime' },
      { $set: { ...runtime } },
      { upsert: true }
    ));
    return writeQueue;
  }
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${STATE_FILE}.tmp`;
    await fsp.writeFile(tempFile, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
    await fsp.rename(tempFile, STATE_FILE);
  });
  return writeQueue;
}

async function initializeDatabase() {
  if (!MONGODB_URI) return;
  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 7000,
      connectTimeoutMS: 7000,
      maxPoolSize: 10
    });
    await mongoClient.connect();
    const database = mongoClient.db(MONGODB_DB);
    const modulesCollection = database.collection('modules');
    const engineersCollection = database.collection('engineers');
    runtimeCollection = database.collection('runtime');

    await Promise.all([
      modulesCollection.createIndex({ moduleCode: 1 }, { unique: true }),
      engineersCollection.createIndex({ id: 1 }, { unique: true })
    ]);
    if (defaultModules.length) {
      await modulesCollection.bulkWrite(defaultModules.map(module => ({
        updateOne: { filter: { moduleCode: module.moduleCode }, update: { $setOnInsert: module }, upsert: true }
      })), { ordered: false });
    }
    if (defaultEngineers.length) {
      await engineersCollection.bulkWrite(defaultEngineers.map(engineer => ({
        updateOne: { filter: { id: engineer.id }, update: { $setOnInsert: engineer }, upsert: true }
      })), { ordered: false });
    }
    const storedRuntime = await runtimeCollection.findOne({ _id: 'console-runtime' });
    if (storedRuntime) {
      const { _id, ...storedState } = storedRuntime;
      runtime = { events: [], workOrders: [], tickets: [], ...storedState };
    } else {
      await runtimeCollection.insertOne({ _id: 'console-runtime', ...runtime });
    }
    modules = await modulesCollection.find({}, { projection: { _id: 0 } }).toArray();
    engineers = await engineersCollection.find({}, { projection: { _id: 0 } }).toArray();
    databaseStatus = { mode: 'mongodb', connected: true, name: MONGODB_DB, error: null };
    console.log(`MongoDB connected: ${MONGODB_DB}`);
  } catch (error) {
    runtimeCollection = null;
    if (mongoClient) await mongoClient.close().catch(() => {});
    mongoClient = null;
    databaseStatus = { mode: 'json-fallback', connected: false, name: MONGODB_DB, error: error.message };
    console.error(`MongoDB unavailable; using JSON fallback: ${error.message}`);
  }
}

function recentActivity(limit = 40) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 100));
  return [...runtime.events]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, safeLimit);
}

function buildFault(module, payload, source) {
  const telemetry = payload.telemetry || {};
  const assignedEngineer = nearestEngineer(module);
  return {
    id: createId('FLT'),
    kind: 'fault',
    status: 'detected',
    severity: clean(payload.severity || 'critical', 20).toLowerCase(),
    faultType: clean(payload.faultType || 'Voltage anomaly', 80),
    source,
    nodeId: module.nodeId,
    moduleCode: module.moduleCode,
    ip: module.ip || null,
    pin: module.pin,
    ward: module.ward,
    section: module.section,
    area: module.area,
    telemetry: {
      phaseR: Number(telemetry.phaseR ?? 0),
      phaseY: Number(telemetry.phaseY ?? 0),
      phaseB: Number(telemetry.phaseB ?? 0),
      neutral: Number(telemetry.neutral ?? 0),
      rssi: Number(telemetry.rssi ?? -86)
    },
    assignedEngineer: assignedEngineer ? {
      id: assignedEngineer.id,
      name: assignedEngineer.name,
      phone: assignedEngineer.phone,
      distanceKm: assignedEngineer.distanceKm
    } : null,
    createdAt: new Date().toISOString(),
    acknowledgedAt: null
  };
}

function addEvent(event) {
  runtime.events.unshift(event);
  runtime.events = runtime.events.slice(0, 250);
  return persistRuntime();
}

app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'local';
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > 60) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  next();
}

app.use(['/api', '/report-fault'], rateLimit);

const loginBuckets = new Map();
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'local';
  const bucket = loginBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 15 * 60_000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  loginBuckets.set(key, bucket);
  if (bucket.count > 10) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  next();
}

app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const username = clean(req.body.username, 80).toLowerCase();
  const password = String(req.body.password || '');
  const role = clean(req.body.role, 20).toLowerCase();
  const account = accounts.find(item => item.username.toLowerCase() === username && item.role === role);
  if (!account || !safeEqual(account.password, password)) {
    return res.status(401).json({ error: 'Invalid username, password, or access type.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...account, password: undefined, expiresAt: Date.now() + SESSION_TTL_MS });
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
  res.json({ status: 'authenticated', user: publicUser(sessions.get(token)) });
});

app.get('/api/auth/me', (req, res) => {
  const session = sessionForRequest(req);
  if (!session) return res.status(401).json({ error: 'Not signed in.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: publicUser(session) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  res.json({ status: 'signed_out' });
});

app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', service: 'DIVYA Grid Console' });
});

app.use(['/api', '/report-fault'], requireAuth);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'DIVYA Grid Console', database: publicDatabaseStatus(), time: new Date().toISOString() });
});

app.get('/api/bootstrap', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    system: { name: 'DIVYA SYSTEM', mode: 'demonstration', connectedNodes: modules.length, updatedAt: runtime.updatedAt, database: publicDatabaseStatus() },
    modules,
    engineers,
    activity: recentActivity(50),
    workOrders: runtime.workOrders.slice(0, 25),
    tickets: runtime.tickets.slice(0, 25)
  });
});

app.get('/api/activity', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ activity: recentActivity(req.query.limit) });
});

async function reportFault(req, res) {
  const module = findModule(req.body);
  if (!module) {
    return res.status(404).json({ error: 'Unknown device. Send a registered nodeId, moduleCode, or IP address.' });
  }
  const event = buildFault(module, req.body, 'device');
  await addEvent(event);
  io.emit('fault_event', event);
  res.status(201).json({ status: 'recorded', event });
}

app.post('/api/faults/report', requireAdmin, reportFault);
app.post('/report-fault', requireAdmin, reportFault);

app.post('/api/faults/simulate', requireAdmin, async (req, res) => {
  const moduleCode = clean(req.body.moduleCode, 80).toUpperCase();
  if (!/^P\d{1,3}-[A-Z]{3}-KOL\d{2}$/.test(moduleCode)) {
    return res.status(400).json({ error: 'A valid DIVYA module code is required.' });
  }
  const simulatedModule = findModule({ moduleCode }) || {
    nodeId: `SIM-${moduleCode}`,
    moduleCode,
    ip: null,
    pin: clean(req.body.pin, 8),
    ward: clean(req.body.ward, 20),
    section: clean(req.body.section, 30),
    area: clean(req.body.area || 'Kolkata grid', 80),
    lat: Number(req.body.lat || 22.5726),
    lng: Number(req.body.lng || 88.3639)
  };
  const event = buildFault(simulatedModule, req.body, 'simulator');
  await addEvent(event);
  io.emit('fault_event', event);
  res.status(201).json({ status: 'recorded', event });
});

app.patch('/api/faults/:id/acknowledge', requireAdmin, async (req, res) => {
  const event = runtime.events.find((item) => item.id === req.params.id && item.kind === 'fault');
  if (!event) return res.status(404).json({ error: 'Fault event not found.' });
  event.status = 'acknowledged';
  event.acknowledgedBy = clean(req.body.acknowledgedBy, 80) || 'Control room operator';
  event.acknowledgedAt = new Date().toISOString();
  await persistRuntime();
  io.emit('fault_acknowledged', event);
  res.json({ status: 'acknowledged', event });
});

app.patch('/api/faults/:id/resolve', requireAdmin, async (req, res) => {
  const event = runtime.events.find((item) => item.id === req.params.id && item.kind === 'fault');
  if (!event) return res.status(404).json({ error: 'Fault event not found.' });
  if (event.status === 'resolved') return res.json({ status: 'resolved', event });
  event.status = 'resolved';
  event.resolvedBy = clean(req.body.resolvedBy, 80) || 'Control room operator';
  event.resolution = clean(req.body.resolution, 160) || 'Fault repaired and supply normalized';
  event.resolvedAt = new Date().toISOString();
  await persistRuntime();
  io.emit('fault_resolved', event);
  res.json({ status: 'resolved', event });
});

app.get('/api/work-orders', (req, res) => {
  const requestedStatus = clean(req.query.status, 30).toLowerCase();
  const workOrders = requestedStatus && requestedStatus !== 'all'
    ? runtime.workOrders.filter((order) => order.status === requestedStatus)
    : runtime.workOrders;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ workOrders: workOrders.slice(0, 100) });
});

app.post('/api/work-orders', requireAdmin, async (req, res) => {
  const networkId = clean(req.body.networkId, 80).toUpperCase();
  const type = clean(req.body.type, 40);
  const scheduledDate = clean(req.body.scheduledDate, 20);
  const technician = clean(req.body.technician, 80);
  if (!networkId || !type || !scheduledDate || !technician) {
    return res.status(400).json({ error: 'Network, type, scheduled date, and technician are required.' });
  }
  if (!/^P\d{1,3}-[A-Z]{3}-KOL\d{2}$/.test(networkId)) {
    return res.status(400).json({ error: 'Network ID is not in the expected DIVYA format.' });
  }
  if (!['Preventive', 'Corrective', 'Emergency', 'Inspection'].includes(type)) {
    return res.status(400).json({ error: 'Select a supported maintenance type.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || scheduledDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Scheduled date must be today or later.' });
  }
  const createdAt = new Date().toISOString();
  const workOrder = {
    id: createId('WO'),
    networkId,
    type,
    scheduledDate,
    technician,
    notes: clean(req.body.notes, 500),
    status: 'dispatched',
    createdAt,
    statusHistory: [{ status: 'dispatched', at: createdAt }]
  };
  runtime.workOrders.unshift(workOrder);
  runtime.workOrders = runtime.workOrders.slice(0, 200);
  await addEvent({ ...workOrder, kind: 'work_order' });
  io.emit('work_order_created', workOrder);
  res.status(201).json({ status: 'created', workOrder });
});

app.patch('/api/work-orders/:id', requireAdmin, async (req, res) => {
  const workOrder = runtime.workOrders.find((order) => order.id === req.params.id);
  if (!workOrder) return res.status(404).json({ error: 'Work order not found.' });
  const nextStatus = clean(req.body.status, 30).toLowerCase();
  const transitions = {
    dispatched: ['en_route'],
    en_route: ['on_site'],
    on_site: ['completed'],
    completed: []
  };
  if (!transitions[workOrder.status]?.includes(nextStatus)) {
    return res.status(409).json({ error: `Cannot move a ${workOrder.status} work order to ${nextStatus || 'an empty status'}.` });
  }
  workOrder.status = nextStatus;
  workOrder.updatedAt = new Date().toISOString();
  workOrder.statusHistory = [...(workOrder.statusHistory || []), { status: nextStatus, at: workOrder.updatedAt }];
  if (nextStatus === 'completed') workOrder.completedAt = workOrder.updatedAt;
  await addEvent({
    id: createId('EVT'), kind: 'work_order_update', workOrderId: workOrder.id,
    networkId: workOrder.networkId, status: nextStatus, technician: workOrder.technician,
    createdAt: workOrder.updatedAt
  });
  io.emit('work_order_updated', workOrder);
  res.json({ status: 'updated', workOrder });
});

app.post('/api/tickets', async (req, res) => {
  const subject = clean(req.body.subject, 120);
  const category = clean(req.body.category, 60);
  const priority = clean(req.body.priority, 20);
  const description = clean(req.body.description, 800);
  if (!subject || !category || !priority || !description) {
    return res.status(400).json({ error: 'Subject, category, priority, and description are required.' });
  }
  const ticket = {
    id: createId('TK'),
    subject,
    category,
    priority,
    networkId: clean(req.body.networkId, 80).toUpperCase() || null,
    description,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  runtime.tickets.unshift(ticket);
  runtime.tickets = runtime.tickets.slice(0, 200);
  await addEvent({ ...ticket, kind: 'ticket' });
  io.emit('ticket_created', ticket);
  res.status(201).json({ status: 'created', ticket });
});

app.get('/api/reports/grid-summary', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="divya-grid-summary-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({ generatedAt: new Date().toISOString(), modules, activity: recentActivity(100) }, null, 2));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'The DIVYA service could not complete this request.' });
});

io.use((socket, next) => {
  const request = { headers: socket.handshake.headers };
  const session = sessionForRequest(request);
  if (!session) return next(new Error('Authentication required'));
  socket.user = publicUser(session);
  next();
});

io.on('connection', (socket) => {
  socket.emit('system_ready', { connectedAt: new Date().toISOString(), latestEvent: recentActivity(1)[0] || null });
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
}, 15 * 60 * 1000).unref();

async function startServer() {
  await initializeDatabase();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`DIVYA Grid Console ready on http://localhost:${PORT}`);
    console.log(`Data storage: ${databaseStatus.mode}`);
  });
}

async function shutdown() {
  if (mongoClient) await mongoClient.close().catch(() => {});
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer().catch(error => {
  console.error('DIVYA startup failed:', error);
  process.exit(1);
});
