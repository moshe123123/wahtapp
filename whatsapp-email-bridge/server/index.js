import 'dotenv/config';
import express from 'express';
import qrcode from 'qrcode';
import pino from 'pino';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { forwardWhatsAppMessageToEmail } from './mailer.js';

const AUTH_FOLDER = './auth_session'; // ⚠️ ב-Render: יש לחבר Persistent Disk לתיקייה הזו,
                                       // אחרת הסשן יימחק בכל דיפלוי מחדש ותצטרך לסרוק QR שוב.

const app = express();
app.use(express.json());

let sock = null;
let lastQR = null; // נשמר כדי להציג אותו בדף /qr

// ---------- אימות בסיסי לכל בקשה מהתוסף ----------
function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ---------- חיבור לוואטסאפ ----------
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQR = qr;
      console.log('QR חדש נוצר - היכנס ל-/qr כדי לסרוק');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('החיבור נסגר, מתחבר מחדש:', shouldReconnect);
      if (shouldReconnect) startWhatsApp();
    } else if (connection === 'open') {
      console.log('✅ מחובר לוואטסאפ בהצלחה');
      lastQR = null;
    }
  });

  // הודעות נכנסות -> העברה למייל
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue; // מתעלמים מהודעות שאני שלחתי בעצמי

      const fromJid = msg.key.remoteJid;
      const fromNumber = fromJid?.split('@')[0];
      const fromName = msg.pushName;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      try {
        await forwardWhatsAppMessageToEmail({ fromNumber, fromName, text });
        console.log(`הודעה מ-${fromNumber} הועברה למייל`);
      } catch (err) {
        console.error('שגיאה בשליחת מייל:', err);
      }
    }
  });

  return sock;
}

// ---------- API עבור תוסף הכרום ----------

// שליחת הודעה יוצאת (מהממשק במייל -> וואטסאפ אמיתי)
app.post('/send', requireApiKey, async (req, res) => {
  const { toNumber, text } = req.body;
  if (!toNumber || !text) {
    return res.status(400).json({ error: 'toNumber and text are required' });
  }
  if (!sock) return res.status(503).json({ error: 'whatsapp not connected yet' });

  try {
    const jid = `${toNumber}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'send failed' });
  }
});

// חיפוש/רשימת אנשי קשר שסונכרנו מהחשבון המחובר
app.get('/contacts', requireApiKey, async (req, res) => {
  if (!sock) return res.status(503).json({ error: 'whatsapp not connected yet' });

  const contacts = Object.values(sock.store?.contacts || {}).map((c) => ({
    id: c.id,
    number: c.id?.split('@')[0],
    name: c.name || c.notify || c.verifiedName || null,
  }));

  res.json({ contacts });
});

// בדיקת בריאות בסיסית
app.get('/health', (req, res) => {
  res.json({ connected: Boolean(sock?.user), user: sock?.user || null });
});

// דף לסריקת QR (פתח פעם אחת בדפדפן כדי לחבר את המכשיר)
app.get('/qr', async (req, res) => {
  if (!lastQR) {
    return res.send('<h2>אין QR פעיל כרגע - או שכבר מחובר, או שממתין לאתחול.</h2>');
  }
  const qrImage = await qrcode.toDataURL(lastQR);
  res.send(`<html><body style="text-align:center;font-family:sans-serif">
    <h2>סרוק את קוד ה-QR מתוך אפליקציית וואטסאפ בטלפון</h2>
    <img src="${qrImage}" />
  </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`שרת רץ על פורט ${PORT}`));
startWhatsApp();
