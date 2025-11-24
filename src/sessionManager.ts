import fs from 'fs';
import path from 'path';
import { makeWASocket, generateWAMessageFromContent, AnyMessageContent, DisconnectReason, fetchLatestBaileysVersion, useSingleFileAuthState, WASocket } from '@adiwajshing/baileys';
import P from 'pino';
import axios from 'axios';

type InstanceOptions = { name?: string; webhook?: string };

type StoredState = {
  id: string;
  name: string;
  authFile: string;
  createdAt: number;
};

const logger = P({ level: 'info' });

export class SessionManager {
  storagePath: string;
  webhookBase: string;
  instances: Map<string, any>; // store instance runtime info

  constructor(opts: { storagePath?: string; webhookBase?: string } = {}) {
    this.storagePath = path.resolve(opts.storagePath || './sessions');
    this.webhookBase = opts.webhookBase || '';
    this.instances = new Map();
    if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
  }

  async init() {
    // load saved instances (by looking for files)
    const files = fs.readdirSync(this.storagePath);
    for (const f of files) {
      if (f.endsWith('.json') && f.startsWith('meta-')) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.storagePath, f), 'utf8')) as StoredState;
          await this._startInstance(meta.id, { name: meta.name, webhook: (meta as any).webhook }); // attempt restore
        } catch (e) {
          logger.error(`Failed restore ${f}: ${(e as Error).message}`);
        }
      }
    }
    logger.info('SessionManager initialized');
  }

  async create(id: string, opts: InstanceOptions = {}) {
    const meta: StoredState = {
      id,
      name: opts.name || id,
      authFile: path.join(this.storagePath, `auth-${id}.json`),
      createdAt: Date.now()
    };
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify({ ...meta, webhook: opts.webhook || null }));
    const info = await this._startInstance(id, opts);
    return { id, createdAt: meta.createdAt, info };
  }

  getState(id: string) {
    return this.instances.get(id) || null;
  }

  async delete(id: string) {
    const inst = this.instances.get(id);
    if (inst && inst.socket) {
      try {
        inst.socket.logout?.();
        inst.socket.end?.();
      } catch (e) {}
    }
    this.instances.delete(id);
    const files = [`meta-${id}.json`, `auth-${id}.json`];
    for (const f of files) {
      const p = path.join(this.storagePath, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  async _startInstance(id: string, opts: InstanceOptions = {}) {
    const authFile = path.join(this.storagePath, `auth-${id}.json`);

    // useSingleFileAuthState exists in Baileys v5; if not available please adapt
    const { state, saveState } = useSingleFileAuthState(authFile);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 2203, 3] }));

    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      version
    });

    const instance: any = {
      id,
      name: opts.name || id,
      webhook: opts.webhook || null,
      socket: sock,
      status: 'initializing',
      qr: null,
      info: null,
      saveState
    };

    // event handlers
    sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        // base64-ready QR image data (Baileys normally gives text QR)
        instance.qr = qr;
        instance.status = 'qr';
      }
      if (connection === 'open') {
        instance.status = 'connected';
        instance.qr = null;
        instance.info = { user: sock.user };
        // forward to webhook
        this._forwardEvent(instance, { type: 'connected', info: instance.info });
      }

      if (connection === 'close') {
        instance.status = 'disconnected';
        const reason = (lastDisconnect?.error?.output?.statusCode) || (lastDisconnect?.error?.message) || lastDisconnect;
        this._forwardEvent(instance, { type: 'disconnected', reason });
      }
      this.instances.set(id, instance);
    });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('messages.upsert', async (m: any) => {
      // forward messages to webhook (if configured)
      this._forwardEvent(instance, { type: 'message', messages: m });
    });

    // store instance meta file
    fs.writeFileSync(path.join(this.storagePath, `meta-${id}.json`), JSON.stringify({ id, name: instance.name, webhook: instance.webhook }));

    this.instances.set(id, instance);
    return { id, status: instance.status };
  }

  async sendText(id: string, to: string, text: string) {
    const inst = this.instances.get(id);
    if (!inst) throw new Error('Instance not found');
    if (!inst.socket) throw new Error('Socket not available');
    // ensure phone format: e.g. '919999999999@s.whatsapp.net' or supply as given
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const result = await inst.socket.sendMessage(jid, { text });
    return result;
  }

  async sendMediaByUrl(id: string, to: string, url: string, caption?: string) {
    const inst = this.instances.get(id);
    if (!inst) throw new Error('Instance not found');
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    // Baileys v5 supports sending media by providing url buffer or file
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    const result = await inst.socket.sendMessage(jid, { image: buffer, caption: caption || '' });
    return result;
  }

  async _forwardEvent(instance: any, payload: any) {
    try {
      if (!instance.webhook) return;
      // POST to configured webhook
      await axios.post(instance.webhook, { id: instance.id, event: payload }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
}
