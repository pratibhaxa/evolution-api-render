require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const SessionManager = require('./sessionManager');

const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 8080;
const API_KEY = process.env.SECRET_KEY || 'secret';
const SESSION_DIR = process.env.SESSION_DIR || './sessions';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

const sessions = new SessionManager({ storagePath: SESSION_DIR });

function authMiddleware(req, res, next) {
  const key = req.header('x-api-key') || req.query.apiKey || req.body.apiKey;
  if (key && key === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized - invalid API key' });
}

/** Health */
app.get('/', (_req, res) => {
  res.json({ status: 'Evolution API (Venom) running', version: '1.0.0' });
});

/** Create instance */
app.post('/instance/create', authMiddleware, async (req, res) => {
  try {
    const { id, name, webhook } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id in body' });
    const info = await sessions.create(id, { name: name || id, webhook });
    return res.json(info);
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Get QR */
app.get('/instance/:id/qr', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const st = sessions.getState(id);
  if (!st) return res.status(404).json({ error: 'Instance not found' });
  return res.json({ id, status: st.status, qr: st.qr });
});

/** Status */
app.get('/instance/:id/status', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const st = sessions.getState(id);
  if (!st) return res.status(404).json({ error: 'Instance not found' });
  return res.json({ id, status: st.status, info: st.info || null });
});

/** Send text message */
app.post('/instance/:id/send-message', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'Missing to or text' });
    const result = await sessions.sendText(id, to, text);
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Send media by URL */
app.post('/instance/:id/send-media', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { to, url, caption } = req.body || {};
    if (!to || !url) return res.status(400).json({ error: 'Missing to or url' });
    const result = await sessions.sendMediaByUrl(id, to, url, caption);
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Delete instance */
app.delete('/instance/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    await sessions.delete(id);
    return res.json({ id, deleted: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Start server + restore sessions */
(async () => {
  await sessions.init();
  app.listen(PORT, () => {
    console.log(`⚡ Evolution API (Venom) running on port ${PORT}`);
  });
})();
