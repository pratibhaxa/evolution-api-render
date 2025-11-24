import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { SessionManager } from './sessionManager';

dotenv.config();

const PORT = process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 8080;
const API_KEY = process.env.SECRET_KEY || 'secret';
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const sessions = new SessionManager({
  storagePath: process.env.SESSION_DIR || './sessions',
  webhookBase: process.env.WEBHOOK_BASE || ''
});

/** Middleware: tiny API key check */
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.header('x-api-key') || req.query.apiKey || req.body.apiKey;
  if (key && key === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized - invalid API key' });
}

/** Health */
app.get('/', (_req, res) => {
  res.json({ status: 'Evolution API clone running', version: '2.1.0' });
});

/** Create instance */
app.post('/instance/create', authMiddleware, async (req, res) => {
  try {
    const { id, name, webhook } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id in body' });
    const info = await sessions.create(id, { name: name || id, webhook });
    return res.json(info);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Get QR (base64 PNG) */
app.get('/instance/:id/qr', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const st = sessions.getState(id);
  if (!st) return res.status(404).json({ error: 'Instance not found' });
  // qrBase64 if available
  const qr = st.qr || null;
  return res.json({ id, status: st.status, qr });
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
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Send media by URL (simple) */
app.post('/instance/:id/send-media', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { to, url, caption } = req.body || {};
    if (!to || !url) return res.status(400).json({ error: 'Missing to or url' });
    const result = await sessions.sendMediaByUrl(id, to, url, caption);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Delete instance */
app.delete('/instance/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    await sessions.delete(id);
    return res.json({ id, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/** Raw webhook receiver (not strictly needed, internal) */
app.post('/instance/:id/webhook', async (req, res) => {
  // used internally by session manager to forward events to configured webhook
  return res.json({ ok: true });
});

/** Start session manager (it will restore sessions) */
(async () => {
  await sessions.init();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`⚡ Evolution API running on port ${PORT}`);
  });
})();
