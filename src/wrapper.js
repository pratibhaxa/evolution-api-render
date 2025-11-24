const express = require('express');
const router = express.Router();

/**
 * We expect a VenomManager instance to be passed in as `req.app.locals.venom`
 * and API key checking handled at app level.
 */

/** version */
router.get('/version', (req, res) => {
  return res.json({ version: '2.0.0', name: 'evolution-api-venom' });
});

/** server status */
router.get('/server/status', (req, res) => {
  const venom = req.app.locals.venom;
  const instances = venom ? venom.list() : [];
  return res.json({ status: 'ok', instancesCount: instances.length, instances });
});

/** list instances (same shape) */
router.get('/instance/list', (req, res) => {
  const venom = req.app.locals.venom;
  const list = venom ? venom.list() : [];
  return res.json({ instances: list });
});

/** generic single instance info */
router.get('/instance/:id', (req, res) => {
  const venom = req.app.locals.venom;
  const id = req.params.id;
  const inst = venom ? venom.get(id) : null;
  if (!inst) return res.status(404).json({ error: 'not_found' });
  return res.json({
    id,
    status: inst.status,
    name: inst.name,
    webhook: inst.webhook,
    info: inst.info || null
  });
});

/** create instance */
router.post('/instance/create', async (req, res) => {
  try {
    const venom = req.app.locals.venom;
    const { id, name, webhook } = req.body || {};
    if (!id) return res.status(400).json({ error: 'missing id' });
    const info = await venom.create(id, { name, webhook });
    return res.json({ id: info.id, createdAt: Date.now(), info });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

/** get instance QR (may be data URL or ASCII) */
router.get('/instance/:id/qr', (req, res) => {
  const venom = req.app.locals.venom;
  const id = req.params.id;
  const inst = venom ? venom.get(id) : null;
  if (!inst) return res.status(404).json({ error: 'not_found' });
  return res.json({ id, status: inst.status, qr: inst.qr || null });
});

/** instance status */
router.get('/instance/:id/status', (req, res) => {
  const venom = req.app.locals.venom;
  const id = req.params.id;
  const inst = venom ? venom.get(id) : null;
  if (!inst) return res.status(404).json({ error: 'not_found' });
  return res.json({ id, status: inst.status, info: inst.info || null });
});

/** send text */
router.post('/instance/:id/send-message', async (req, res) => {
  try {
    const venom = req.app.locals.venom;
    const id = req.params.id;
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'missing to/text' });
    const result = await venom.sendText(id, to, text);
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

/** send media */
router.post('/instance/:id/send-media', async (req, res) => {
  try {
    const venom = req.app.locals.venom;
    const id = req.params.id;
    const { to, url, caption } = req.body || {};
    if (!to || !url) return res.status(400).json({ error: 'missing to/url' });
    const result = await venom.sendMediaByUrl(id, to, url, caption);
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

/** delete instance */
router.delete('/instance/:id', async (req, res) => {
  try {
    const venom = req.app.locals.venom;
    const id = req.params.id;
    await venom.delete(id);
    return res.json({ id, deleted: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

module.exports = router;
