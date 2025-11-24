require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pino = require('pino');
const VenomManager = require('./venomManager');
const wrapper = require('./wrapper');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 8080;
const API_KEY = process.env.SECRET_KEY || 'secret';
const SESSION_DIR = process.env.SESSION_DIR || './sessions';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

// simple API key middleware
function authMiddleware(req, res, next) {
  // allow health & version without key for convenience
  if (req.path === '/' || req.path.startsWith('/version') || req.path.startsWith('/server/status')) return next();
  const key = req.header('x-api-key') || req.query.apiKey || req.body.apiKey;
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - invalid API key' });
  }
  return next();
}
app.use(authMiddleware);

// instantiate venom manager and attach to app
const venom = new VenomManager({ storagePath: SESSION_DIR });
app.locals.venom = venom;

// health & version endpoints used by n8n
app.get('/', (_req, res) => res.json({ status: 'ok', message: 'Evolution API (Venom) running' }));
app.get('/version', (_req, res) => res.json({ version: '2.0.0', name: 'evolution-api-venom' }));
app.get('/server/status', (_req, res) => {
  const list = venom.list();
  res.json({ status: 'ok', instancesCount: list.length });
});

// mount wrapper
app.use('/', wrapper);

// start
(async () => {
  await venom.init();
  app.listen(PORT, () => {
    log.info(`⚡ Evolution API (Venom) running on port ${PORT}`);
  });
})();
