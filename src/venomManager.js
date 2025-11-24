const path = require('path');
const fs = require('fs');
const venom = require('venom-bot');
const axios = require('axios');

class VenomManager {
  constructor(opts = {}) {
    this.storagePath = path.resolve(opts.storagePath || './sessions');
    if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
    this.instances = new Map(); // id -> { client, status, qr, info, webhook }
  }

  async init() {
    // restore meta files
    const files = fs.readdirSync(this.storagePath);
    for (const f of files) {
      if (f.startsWith('meta-') && f.endsWith('.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.storagePath, f), 'utf8'));
          // try to start instance; ignore errors
          await this._startInstance(meta.id, { name: meta.name, webhook: meta.webhook }).catch(()=>{});
        } catch (e) {
          console.error('restore error', f, e.message);
        }
      }
    }
    return true;
  }

  async create(id, opts = {}) {
    if (!id) throw new Error('missing id');
    const meta = { id, name: opts.name || id, webhook: opts.webhook || null, createdAt: Date.now() };
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify(meta));
    const info = await this._startInstance(id, opts);
    return { id, createdAt: meta.createdAt, info };
  }

  list() {
    const out = [];
    for (const [id, inst] of this.instances.entries()) {
      out.push({ id, status: inst.status, name: inst.name, webhook: inst.webhook });
    }
    return out;
  }

  get(id) {
    return this.instances.get(id) || null;
  }

  async delete(id) {
    const inst = this.instances.get(id);
    if (inst && inst.client) {
      try { await inst.client.close(); } catch(e) {}
    }
    this.instances.delete(id);
    // remove files
    const p = (name) => path.join(this.storagePath, name);
    [ `meta-${id}.json`, id ].forEach(f => {
      const fp = p(f);
      if (fs.existsSync(fp)) {
        try { fs.rmSync(fp, { recursive: true, force: true }); } catch(e) {}
      }
    });
    return true;
  }

  async _startInstance(id, opts = {}) {
    if (this.instances.has(id) && this.instances.get(id).client) {
      const current = this.instances.get(id);
      return { id, status: current.status };
    }

    const sessionFolder = path.join(this.storagePath); // venom will use folderNameToken to store tokens
    let lastQr = null;
    let status = 'initializing';
    let webhook = opts.webhook || null;
    let client;

    // venom create: we pass session name so multiple sessions are supported
    try {
      client = await venom.create(
        id,
        (base64Qr, asciiQR, attempts, urlCode) => {
          // base64Qr is data:image/png;base64,... when available
          lastQr = base64Qr || asciiQR || urlCode || null;
          status = 'qr';
          const inst = this.instances.get(id) || {};
          inst.qr = lastQr;
          inst.status = status;
          this.instances.set(id, inst);
        },
        (statusSession) => {
          // statusSession values: 'isLogged', 'qrReadSuccess', 'desconnectedMobile', ...
          status = statusSession;
          const inst = this.instances.get(id) || {};
          inst.status = status;
          this.instances.set(id, inst);
        },
        {
          session: id,
          folderNameToken: sessionFolder,
          multidevice: false,
          autoClose: 24 * 60 * 60 * 1000 // 24 hours
        }
      );
    } catch (err) {
      console.error('venom create failed', err && err.message);
      throw err;
    }

    const instance = {
      id,
      name: opts.name || id,
      webhook,
      client,
      status: 'connected',
      qr: lastQr,
      info: null
    };

    // try to fetch basic info if possible
    try {
      const wInfo = await client.getConnectionState();
      instance.info = wInfo || null;
    } catch (e) {}

    // attach onMessage
    client.onMessage(async (message) => {
      // forward to webhook if configured
      if (instance.webhook) {
        try {
          await axios.post(instance.webhook, { id, event: { type: 'message', message } }).catch(()=>{});
        } catch(e){}
      }
    });

    // persist meta
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify({ id, name: instance.name, webhook: instance.webhook }));

    this.instances.set(id, instance);
    return { id, status: instance.status };
  }

  async sendText(id, to, text) {
    const inst = this.instances.get(id);
    if (!inst || !inst.client) throw new Error('instance not found or not connected');
    const jid = to.includes('@') ? to : `${to}@c.us`;
    const res = await inst.client.sendText(jid, text);
    return res;
  }

  async sendMediaByUrl(id, to, url, caption) {
    const inst = this.instances.get(id);
    if (!inst || !inst.client) throw new Error('instance not found or not connected');
    const jid = to.includes('@') ? to : `${to}@c.us`;
    const res = await inst.client.sendFileFromUrl(jid, url, '', caption || '');
    return res;
  }
}

module.exports = VenomManager;
