const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createStore } = require('./storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const store = createStore();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  next();
});

const buckets = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const bucket = buckets.get(req.ip) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) Object.assign(bucket, { start: now, count: 0 });
  bucket.count += 1;
  buckets.set(req.ip, bucket);
  if (bucket.count > 120) return res.status(429).json({ error: 'Too many requests' });
  next();
});

function requireDeviceKey(req, res, next) {
  const expected = process.env.DEVICE_API_KEY;
  if (!expected) return next();
  const supplied = req.get('x-device-api-key') || '';
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid device API key' });
  next();
}
function missing(body, fields) { return fields.filter((f) => typeof body[f] !== 'string' || !body[f].trim()); }
const failMissing = (res, fields) => res.status(400).json({ error: `Missing fields: ${fields.join(', ')}` });

app.get('/api/health', async (_req, res, next) => {
  try { await store.health(); res.json({ status: 'ok', service: 'divya-system', time: new Date().toISOString() }); }
  catch (error) { next(error); }
});
for (const table of ['events', 'work_orders', 'tickets', 'dispatches']) {
  app.get(`/api/${table.replace('_', '-')}`, async (req, res, next) => {
    try { res.json(await store.list(table, Number(req.query.limit) || 100)); } catch (error) { next(error); }
  });
}

app.post('/api/work-orders', async (req, res, next) => {
  const absent = missing(req.body, ['networkId', 'type', 'scheduledDate', 'technician']);
  if (absent.length) return failMissing(res, absent);
  try {
    const item = await store.create('work_orders', { networkId: req.body.networkId.trim(), type: req.body.type.trim(), scheduledDate: req.body.scheduledDate.trim(), technician: req.body.technician.trim(), notes: String(req.body.notes || '').trim(), status: 'scheduled' });
    io.emit('work_order_created', item); res.status(201).json(item);
  } catch (error) { next(error); }
});

app.post('/api/tickets', async (req, res, next) => {
  const absent = missing(req.body, ['subject', 'category', 'priority', 'description']);
  if (absent.length) return failMissing(res, absent);
  try {
    const item = await store.create('tickets', { subject: req.body.subject.trim(), category: req.body.category.trim(), priority: req.body.priority.trim(), networkId: String(req.body.networkId || '').trim(), description: req.body.description.trim(), status: 'open' });
    io.emit('ticket_created', item); res.status(201).json(item);
  } catch (error) { next(error); }
});

app.post('/api/dispatches', async (req, res, next) => {
  const absent = missing(req.body, ['networkId', 'dispatcher']);
  if (absent.length) return failMissing(res, absent);
  try {
    const item = await store.create('dispatches', { networkId: req.body.networkId.trim(), dispatcher: req.body.dispatcher.trim(), memo: String(req.body.memo || '').trim(), status: 'authorized' });
    io.emit('dispatch_authorized', item); res.status(201).json(item);
  } catch (error) { next(error); }
});

async function reportFault(req, res, next) {
  const ip = String(req.body.ip || '').trim();
  const moduleId = String(req.body.moduleId || ip).trim();
  if (!moduleId) return res.status(400).json({ error: 'moduleId or ip is required' });
  if (ip && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP address' });
  try {
    const item = await store.create('events', { moduleId, ip, eventType: 'fault', severity: String(req.body.severity || 'critical'), voltage: Number.isFinite(Number(req.body.voltage)) ? Number(req.body.voltage) : null, details: String(req.body.details || '').trim(), status: 'open' });
    io.emit('fault_event', item); res.status(201).json(item);
  } catch (error) { next(error); }
}
app.post('/api/faults', requireDeviceKey, reportFault);
app.post('/report-fault', requireDeviceKey, reportFault);

app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });
io.on('connection', (socket) => socket.emit('connected', { time: new Date().toISOString() }));

const PORT = Number(process.env.PORT) || 3000;
async function start() { await store.init(); server.listen(PORT, '0.0.0.0', () => console.log(`DIVYA System listening on ${PORT}`)); }
start().catch((error) => { console.error(error); process.exit(1); });
module.exports = { app, server };
