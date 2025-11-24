const fs = require('fs');
const path = require('path');
const venom = require('venom-bot');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class SessionManager {
  constructor(opts = {}) {
    this.storagePath = path.resolve(opts.storagePath || './sessions');
    this.instances = new Map();
    if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
  }

  async init() {
    const files = fs.readdirSync(this.storagePath);
    for (const f of files) {
      if (f.startsWith('meta-') && f.endsWith('.json')) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.storagePath, f), 'utf8'));
          await this._startInstance(meta.id, { name: meta.name, webhook: meta.webhook });
        } catch (e) {
          console.error('restore failed', f, e.message);
        }
      }
    }
    console.log('SessionManager initialized, instances:', Array.from(this.instances.keys()));
  }

  async create(id, opts = {}) {
    const meta = { id, name: opts.name || id, webhook: opts.webhook || null, createdAt: Date.now() };
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify(meta));
    const info = await this._startInstance(id, opts);
    return { id, createdAt: meta.createdAt, info };
  }

  getState(id) {
    return this.instances.get(id) || null;
  }

  async delete(id) {
    const inst = this.instances.get(id);
    if (inst && inst.client) {
      try { await inst.client.close(); } catch (e) {}
    }
    this.instances.delete(id);
    const files = [`meta-${id}.json`, `${id}.json`, `${id}`];
    for (const f of files) {
      const p = path.join(this.storagePath, f);
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
      }
    }
  }

  async _startInstance(id, opts = {}) {
    const sessionPath = path.join(this.storagePath, id);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    let instance = this.instances.get(id);
    if (instance && instance.client) return { id, status: instance.status };

    // create client with venom-bot
    const qrs = { last: null }; // store last qr text/base64
    const clientPromise = venom
      .create(id, (base64Qr, asciiQR) => {
        // base64Qr is a dataURL string (image/png;base64,....)
        qrs.last = base64Qr || asciiQR || null;
        const inst = this.instances.get(id) || {};
        inst.qr = qrs.last;
        inst.status = 'qr';
        this.instances.set(id, inst);
      }, (statusSession) => {
        // status: 'isLogged', 'qrReadSuccess', etc.
        const inst = this.instances.get(id) || {};
        inst.status = statusSession;
        this.instances.set(id, inst);
      }, {
        session: id,
        folderNameToken: this.storagePath,
        multidevice: false, // recommended false for stability
        autoClose: 60 * 60 * 24 // keep open 24h (adjust)
      })
      .then(client => client)
      .catch(err => {
        console.error('venom create failed', err && err.message);
        throw err;
      });

    const client = await clientPromise;

    instance = {
      id,
      name: opts.name || id,
      webhook: opts.webhook || null,
      client,
      status: 'connected',
      qr: qrs.last,
      info: null
    };

    // attach message handler
    client.onMessage(async (message) => {
      // forward to webhook if configured
      if (instance.webhook) {
        try {
          await axios.post(instance.webhook, { id, event: { type: 'message', message } }).catch(()=>{});
        } catch(e){}
      }
    });

    // store meta file
    const meta = { id, name: instance.name, webhook: instance.webhook, createdAt: Date.now() };
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify(meta));

    this.instances.set(id, instance);
    return { id, status: instance.status };
  }

  async sendText(id, to, text) {
    const inst = this.instances.get(id);
    if (!inst) throw new Error('Instance not found');
    const jid = to.includes('@') ? to : `${to}@c.us`; // venom uses '@c.us'
    const res = await inst.client.sendText(jid, text);
    return res;
  }

  async sendMediaByUrl(id, to, url, caption) {
    const inst = this.instances.get(id);
    if (!inst) throw new Error('Instance not found');
    const jid = to.includes('@') ? to : `${to}@c.us`;
    const media = await inst.client.sendFileFromUrl(jid, url, '', caption || '');
    return media;
  }
}

module.exports = SessionManager;
