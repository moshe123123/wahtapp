import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestVerificationCode, verifyCode, sendWhatsAppText, registerPhoneNumber } from './whatsappClient.js';
import { forwardWhatsAppMessageToEmail } from './mailer.js';
import { logger } from './logger.js';
import axios from 'axios';

// כתובת ה-Apps Script (Web App) שמנהלת את הגיליון + Gmail native - קריאת שרת-לשרת,
// לא נחסמת בנטפרי כי הדפדפן של המשתמש לא מעורב בקריאה הזו בכלל
async function forwardToAppsScript(fromNumber, fromName, text) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return; // אופציונלי - אם לא הוגדר, פשוט מדלגים
  const payload = {
    object: 'whatsapp_business_account', // מדמה בדיוק את מבנה ה-webhook האמיתי של מטא
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from: fromNumber, text: { body: text } }],
              contacts: [{ wa_id: fromNumber, profile: { name: fromName || fromNumber } }],
            },
          },
        ],
      },
    ],
  };
  try {
    await postFollowingRedirect(url, payload);
    logger.info('הודעה הועברה בהצלחה ל-Apps Script');
  } catch (err) {
    logger.error('העברה ל-Apps Script נכשלה', err.message);
  }
}

// עוקב ידנית אחרי redirect תוך שימור ה-method וה-body (Apps Script תמיד מפנה עם 302,
// וספריות רבות הופכות POST ל-GET אוטומטית ב-redirect - כאן מונעים את זה בכוונה)
async function postFollowingRedirect(url, payload, maxHops = 5) {
  let currentUrl = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await axios.post(currentUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
      validateStatus: (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      currentUrl = res.headers.location;
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

// מאגר שיחות פשוט בזיכרון - key = מספר טלפון, value = מערך הודעות {direction, text, time}
// זה מה שמאפשר ממשק התכתבות באזור האישי, בלי קשר לתוסף הכרום/Gmail
const conversations = new Map();

function addMessageToConversation(number, direction, text) {
  if (!conversations.has(number)) conversations.set(number, []);
  const list = conversations.get(number);
  list.push({ direction, text, time: new Date().toISOString() }); // direction: 'in' | 'out'
  if (list.length > 200) list.shift(); // הגבלת גודל למניעת גדילה אינסופית
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// מאפשר לתוסף הכרום (שרץ על הדומיין mail.google.com) לגשת ל-API של השרת -
// בלי זה, הדפדפן חוסם את הבקשות מסיבות אבטחה (CORS)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public'))); // האזור האישי (index.html)

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_KEY) {
    logger.warn('בקשה נדחתה - מפתח API שגוי/חסר', { path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// לוג בסיסי לכל בקשה שמגיעה לשרת (עוזר לראות אם בכלל משהו מגיע, למשל מה-webhook)
app.use((req, res, next) => {
  logger.info(`בקשה נכנסת: ${req.method} ${req.path}`);
  next();
});

// ---------- אזור אישי: רישום מספר בשני שלבים ----------

// שלב 1: לחיצה על "שלח לי קוד" באתר
app.post('/register/request-code', requireApiKey, async (req, res) => {
  try {
    const { method } = req.body; // 'SMS' או 'VOICE'
    const data = await requestVerificationCode({ codeMethod: method || 'SMS' });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /register/request-code נכשל', details);
    res.status(500).json({ error: details });
  }
});

// שלב 2: הזנת הקוד שהתקבל בשיחה/SMS
app.post('/register/verify-code', requireApiKey, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });
    const data = await verifyCode({ code });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /register/verify-code נכשל', details);
    res.status(500).json({ error: details });
  }
});

// רישום המספר בפועל מול Cloud API - שלב טכני נפרד, לרוב נדרש פעם אחת לפני שליחה ראשונה
app.post('/register/activate-number', requireApiKey, async (req, res) => {
  try {
    const { pin } = req.body;
    const data = await registerPhoneNumber({ pin: pin || '123456' });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /register/activate-number נכשל', details);
    res.status(500).json({ error: details });
  }
});

// ---------- Webhook של מטא: קבלת הודעות נכנסות ----------

// אימות ה-Webhook (חד פעמי, כשמגדירים אותו בדשבורד של מטא)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    logger.info('אימות Webhook מול מטא הצליח');
    return res.status(200).send(challenge);
  }
  logger.warn('אימות Webhook נכשל - טוקן לא תואם', { receivedToken: token });
  res.sendStatus(403);
});

// קבלת הודעות אמיתיות מוואטסאפ
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    const statuses = value?.statuses;

    if (messages && messages.length) {
      for (const msg of messages) {
        const fromNumber = msg.from;
        const contact = value.contacts?.find((c) => c.wa_id === fromNumber);
        const fromName = contact?.profile?.name;
        const text = msg.text?.body || '';

        logger.info('התקבלה הודעת וואטסאפ נכנסת', { fromNumber, fromName, text });
        addMessageToConversation(fromNumber, 'in', text);
        await forwardWhatsAppMessageToEmail({ fromNumber, fromName, text });
        await forwardToAppsScript(fromNumber, fromName, text);
      }
    } else if (statuses && statuses.length) {
      // עדכוני סטטוס (נשלח/נמסר/נקרא) - שימושי לדיבוג בעיות שליחה
      for (const s of statuses) {
        logger.info('עדכון סטטוס הודעה יוצאת', { id: s.id, status: s.status, recipient: s.recipient_id });
        if (s.errors) {
          logger.error('פרטי שגיאת שליחה', JSON.stringify(s.errors));
        }
      }
    } else {
      logger.warn('התקבלה קריאת webhook ללא הודעות/סטטוסים מזוהים', req.body);
    }

    res.sendStatus(200); // תמיד להחזיר 200 כדי שמטא לא תנסה לשלוח שוב
  } catch (err) {
    logger.error('שגיאה בטיפול ב-webhook', err.message);
    res.sendStatus(200);
  }
});

// ---------- שליחת הודעה יוצאת (מהתוסף בג'ימייל) ----------
app.post('/send', requireApiKey, async (req, res) => {
  const { toNumber, text } = req.body;
  if (!toNumber || !text) {
    return res.status(400).json({ error: 'toNumber and text are required' });
  }
  try {
    const data = await sendWhatsAppText({ toNumber, text });
    addMessageToConversation(toNumber, 'out', text);
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send נכשל', details);
    res.status(500).json({ error: details });
  }
});

// ---------- שיחות: ממשק התכתבות פשוט מהאזור האישי ----------

// רשימת מספרים שיש איתם שיחה (לתפריט בחירה)
app.get('/conversations', requireApiKey, (req, res) => {
  const list = [...conversations.keys()].map((number) => {
    const msgs = conversations.get(number);
    const last = msgs[msgs.length - 1];
    return { number, lastMessage: last?.text, lastTime: last?.time };
  });
  res.json({ conversations: list });
});

// היסטוריית הודעות עם מספר ספציפי
app.get('/conversations/:number', requireApiKey, (req, res) => {
  const messages = conversations.get(req.params.number) || [];
  res.json({ messages });
});

// ---------- לוגים: לצפייה מהאזור האישי ----------
app.get('/logs', requireApiKey, (req, res) => {
  res.json({ logs: logger.getAll() });
});

app.post('/logs/clear', requireApiKey, (req, res) => {
  logger.clear();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// תפיסת שגיאות גלובליות שלא נתפסו בקוד - כדי שגם הן יופיעו בלוג ולא "ייעלמו" בשקט
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`שרת Cloud API רץ על פורט ${PORT}`);
});
