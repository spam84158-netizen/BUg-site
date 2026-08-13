require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const P = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  delay,
} = require('@whiskeysockets/baileys');

const { MESSAGES } = require('./messages');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ── Chaque visiteur a sa propre session WhatsApp (son propre numéro) ──
// sessions[userId] = BotSession   |   userSockets[userId] = socket.id courant
const sessions = {};
const userSockets = {};

class BotSession {
  constructor(userId) {
    this.userId = userId;
    this.sock = null;
    this.isConnected = false;
    this.isInitializing = false;
    this.authPath = path.join(AUTH_DIR, userId);
    this.connectedNumber = null;
  }

  emitToUser(event, payload) {
    const socketId = userSockets[this.userId];
    if (socketId) io.to(socketId).emit(event, payload);
  }

  sendStatus() {
    this.emitToUser('connection-status', {
      connected: this.isConnected,
      number: this.connectedNumber,
    });
  }

  async initialize(pairingNumber) {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const { version } = await fetchLatestBaileysVersion();
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' })),
        },
        printQRInTerminal: false,
        logger: P({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
      });

      if (pairingNumber && !state.creds.registered) {
        await delay(2000);
        try {
          let code = await this.sock.requestPairingCode(pairingNumber);
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          this.emitToUser('pairing-code', code);
        } catch (err) {
          this.emitToUser('pairing-error', err.message || 'Erreur de pairing.');
        }
      }

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          this.isConnected = true;
          this.connectedNumber = this.sock.user?.id?.split(':')[0]?.split('@')[0] || pairingNumber || null;
          this.sendStatus();
        } else if (connection === 'close') {
          this.isConnected = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          this.sendStatus();

          if (loggedOut) {
            if (fs.existsSync(this.authPath)) fs.rmSync(this.authPath, { recursive: true, force: true });
            delete sessions[this.userId];
          } else {
            setTimeout(() => this.initialize().catch(() => {}), 4000);
          }
        }
      });
    } catch (err) {
      this.emitToUser('pairing-error', err.message || 'Erreur de connexion.');
    } finally {
      this.isInitializing = false;
    }
  }
}

io.on('connection', (socket) => {
  socket.on('set-user', (userId) => {
    if (!userId) return;
    userSockets[userId] = socket.id;
    socket.userId = userId;
    if (sessions[userId]) sessions[userId].sendStatus();
    else socket.emit('connection-status', { connected: false, number: null });
  });

  socket.on('pair-request', async ({ userId, number }) => {
    if (!userId || !number) return;
    userSockets[userId] = socket.id;
    if (!sessions[userId]) sessions[userId] = new BotSession(userId);
    if (sessions[userId].isConnected) { sessions[userId].sendStatus(); return; }
    await sessions[userId].initialize(String(number).replace(/[^0-9]/g, ''));
  });

  socket.on('logout', async (userId) => {
    const s = sessions[userId];
    if (s) {
      try { if (s.sock) await s.sock.logout(); } catch (e) {}
      if (fs.existsSync(s.authPath)) fs.rmSync(s.authPath, { recursive: true, force: true });
      delete sessions[userId];
    }
    const socketId = userSockets[userId];
    if (socketId) io.to(socketId).emit('connection-status', { connected: false, number: null });
  });

  socket.on('disconnect', () => {
    for (const userId in userSockets) {
      if (userSockets[userId] === socket.id) { delete userSockets[userId]; break; }
    }
  });
});

// ── Liste des options/messages pour construire le menu côté client ──
app.get('/api/menu', (req, res) => {
  const menu = {};
  for (const [key, opt] of Object.entries(MESSAGES)) {
    menu[key] = {
      label: opt.label,
      items: Object.fromEntries(
        Object.entries(opt.items).map(([k, v]) => [k, v.label])
      ),
    };
  }
  res.json(menu);
});

// ── Statut de connexion d'un utilisateur (vérif rapide côté HTTP) ──
app.get('/api/status', (req, res) => {
  const userId = req.query.userId;
  const s = userId && sessions[userId];
  res.json({ connected: !!(s && s.isConnected), number: s ? s.connectedNumber : null });
});

// ── Envoi d'un message préréglé — depuis le numéro personnel de l'utilisateur connecté ──
app.post('/api/send', async (req, res) => {
  const { userId, option, submenu, number } = req.body;

  const session = sessions[userId];
  if (!session || !session.isConnected) {
    return res.status(503).json({ ok: false, error: 'Connecte d\'abord ton numéro WhatsApp.' });
  }

  const clean = String(number || '').replace(/[^0-9]/g, '');
  if (clean.length < 8) {
    return res.status(400).json({ ok: false, error: 'Numéro non valide.' });
  }

  const preset = MESSAGES[option]?.items?.[submenu];
  if (!preset) {
    return res.status(400).json({ ok: false, error: 'Message introuvable.' });
  }

  try {
    const jid = `${clean}@s.whatsapp.net`;
    await session.sock.sendMessage(jid, { text: preset.text });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Site lancé sur le port ${PORT}`));
