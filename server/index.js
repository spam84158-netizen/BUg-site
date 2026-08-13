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

// messages.js reste INTACT
const { MENUS: MESSAGES } = require('./messages');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Chaque visiteur possède sa propre session WhatsApp
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

    if (socketId) {
      io.to(socketId).emit(event, payload);
    }
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

      const { state, saveCreds } =
        await useMultiFileAuthState(this.authPath);

      this.sock = makeWASocket({
        version,

        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            P({ level: 'fatal' })
          ),
        },

        printQRInTerminal: false,
        logger: P({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
      });

      if (pairingNumber && !state.creds.registered) {
        await delay(2000);

        try {
          let code =
            await this.sock.requestPairingCode(pairingNumber);

          code =
            code?.match(/.{1,4}/g)?.join('-') || code;

          this.emitToUser('pairing-code', code);
        } catch (err) {
          this.emitToUser(
            'pairing-error',
            err?.message || 'Erreur de pairing.'
          );
        }
      }

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', (update) => {
        const {
          connection,
          lastDisconnect,
        } = update;

        if (connection === 'open') {
          this.isConnected = true;

          this.connectedNumber =
            this.sock.user?.id
              ?.split(':')[0]
              ?.split('@')[0] ||
            pairingNumber ||
            null;

          this.sendStatus();
        }

        else if (connection === 'close') {
          this.isConnected = false;

          const statusCode =
            lastDisconnect?.error?.output?.statusCode;

          const loggedOut =
            statusCode === DisconnectReason.loggedOut;

          this.sendStatus();

          if (loggedOut) {
            if (fs.existsSync(this.authPath)) {
              fs.rmSync(this.authPath, {
                recursive: true,
                force: true,
              });
            }

            delete sessions[this.userId];
          }

          else {
            setTimeout(() => {
              this.initialize().catch((err) => {
                console.error(
                  `[${this.userId}] Reconnexion échouée:`,
                  err?.message || err
                );
              });
            }, 4000);
          }
        }
      });

    } catch (err) {
      console.error(
        `[${this.userId}] Erreur de connexion:`,
        err?.message || err
      );

      this.emitToUser(
        'pairing-error',
        err?.message || 'Erreur de connexion.'
      );
    }

    finally {
      this.isInitializing = false;
    }
  }
}

io.on('connection', (socket) => {

  socket.on('set-user', (userId) => {
    if (!userId) return;

    userSockets[userId] = socket.id;
    socket.userId = userId;

    if (sessions[userId]) {
      sessions[userId].sendStatus();
    }

    else {
      socket.emit('connection-status', {
        connected: false,
        number: null,
      });
    }
  });


  socket.on(
    'pair-request',
    async ({ userId, number }) => {

      if (!userId || !number) return;

      userSockets[userId] = socket.id;

      if (!sessions[userId]) {
        sessions[userId] =
          new BotSession(userId);
      }

      if (sessions[userId].isConnected) {
        sessions[userId].sendStatus();
        return;
      }

      await sessions[userId].initialize(
        String(number).replace(/[^0-9]/g, '')
      );
    }
  );


  socket.on('logout', async (userId) => {

    const s = sessions[userId];

    if (s) {

      try {
        if (s.sock) {
          await s.sock.logout();
        }
      }

      catch (e) {
        // Ignore
      }

      if (fs.existsSync(s.authPath)) {
        fs.rmSync(s.authPath, {
          recursive: true,
          force: true,
        });
      }

      delete sessions[userId];
    }

    const socketId =
      userSockets[userId];

    if (socketId) {
      io.to(socketId).emit(
        'connection-status',
        {
          connected: false,
          number: null,
        }
      );
    }
  });


  socket.on('disconnect', () => {

    for (const userId in userSockets) {

      if (
        userSockets[userId] === socket.id
      ) {
        delete userSockets[userId];
        break;
      }
    }
  });
});


// ─────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────

app.get('/api/menu', (req, res) => {

  const menu = {};

  for (
    const [key, opt]
    of Object.entries(MESSAGES)
  ) {

    menu[key] = {
      label: opt.label,

      items: Object.fromEntries(
        Object.entries(opt.items).map(
          ([k, v]) => [
            k,
            v.label
          ]
        )
      ),
    };
  }

  res.json(menu);
});


// ─────────────────────────────────────────────
// STATUT
// ─────────────────────────────────────────────

app.get('/api/status', (req, res) => {

  const userId = req.query.userId;

  const s =
    userId && sessions[userId];

  res.json({
    connected:
      !!(
        s &&
        s.isConnected &&
        s.sock
      ),

    number:
      s
        ? s.connectedNumber
        : null,
  });
});


// ─────────────────────────────────────────────
// ENVOI WHATSAPP
// messages.js reste totalement intact.
// ─────────────────────────────────────────────

app.post('/api/send', async (req, res) => {

  const {
    userId,
    option,
    submenu,
    number,
  } = req.body;


  // 1. Vérification de la session

  const session =
    sessions[userId];

  if (
    !session ||
    !session.sock ||
    !session.isConnected
  ) {

    return res.status(503).json({
      ok: false,
      error:
        'La session WhatsApp n’est pas connectée.',
    });
  }


  // 2. Nettoyage du numéro

  const clean =
    String(number || '')
      .replace(/\D/g, '');


  if (clean.length < 8) {

    return res.status(400).json({
      ok: false,
      error:
        'Numéro non valide.',
    });
  }


  // 3. Récupération du message

  const preset =
    MESSAGES[option]
      ?.items?.[submenu];


  if (!preset) {

    return res.status(400).json({
      ok: false,
      error:
        'Message introuvable.',
    });
  }


  // Ton messages.js utilise unicodeMessage.
  const messageText =
    preset.unicodeMessage ||
    preset.text;


  if (!messageText) {

    return res.status(400).json({
      ok: false,
      error:
        'Le contenu du message est vide.',
    });
  }


  try {

    console.log(
      `[SEND] Vérification du numéro : ${clean}`
    );


    // 4. Vérification du numéro auprès de WhatsApp

    const whatsappResult =
      await session.sock.onWhatsApp(clean);


    console.log(
      '[SEND] Réponse onWhatsApp:',
      whatsappResult
    );


    if (
      !Array.isArray(whatsappResult) ||
      whatsappResult.length === 0
    ) {

      return res.status(404).json({
        ok: false,
        error:
          'WhatsApp ne retourne aucune information pour ce numéro.',
      });
    }


    // 5. Récupération du contact reconnu

    const contact =
      whatsappResult.find(
        (item) => item?.exists
      );


    if (
      !contact ||
      !contact.jid
    ) {

      return res.status(404).json({
        ok: false,
        error:
          'Ce numéro ne correspond pas à un compte WhatsApp.',
      });
    }


    // 6. JID fourni par WhatsApp

    const jid =
      contact.jid;


    console.log(
      `[SEND] JID WhatsApp confirmé : ${jid}`
    );

    console.log(
      '[SEND] Envoi du message...'
    );


    // 7. Envoi réel

    const result =
      await session.sock.sendMessage(
        jid,
        {
          text: messageText,
        }
      );


    console.log(
      '[SEND] Réponse sendMessage:',
      result
    );


    // 8. Vérification de la réponse

    if (
      !result ||
      !result.key ||
      !result.key.id
    ) {

      return res.status(502).json({
        ok: false,
        error:
          'WhatsApp n’a pas retourné d’identifiant de message.',
      });
    }


    console.log(
      `[SEND] Message accepté par la session. ID: ${result.key.id}`
    );


    // 9. Succès réel de l'appel d'envoi

    return res.json({
      ok: true,
      messageId: result.key.id,
      jid: jid,
    });

  }

  catch (err) {

    console.error(
      '[SEND] ERREUR:',
      err
    );


    return res.status(500).json({
      ok: false,
      error:
        err?.message ||
        'Erreur inconnue lors de l’envoi WhatsApp.',
    });
  }
});


// ─────────────────────────────────────────────
// SERVEUR
// ─────────────────────────────────────────────

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  () => {
    console.log(
      `🌐 Site lancé sur le port ${PORT}`
    );
  }
);
