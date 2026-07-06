import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestVerificationCode, verifyCode, sendWhatsAppText, registerPhoneNumber } from './whatsappClient.js';
import { forwardWhatsAppMessageToEmail } from './mailer.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // האזור האישי (index.html)

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_KEY) {
    logger.warn('בקשה נדחתה - מפתח API שגוי/חסר', { path: req.path, ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.use((req, res, next) => {
  logger.info(`בקשה נכנסת: ${req.method} ${req.path}`);
  next();
});

app.post('/register/request-code', requireApiKey, async (req, res) => {
  try {
    const { method } = req.body;
    const data = await requestVerificationCode({ codeMethod: method || 'SMS' });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /register/request-code נכשל', details);
    res.status(500).json({ error: details });
  }
});

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
        await forwardWhatsAppMessageToEmail({ fromNumber, fromName, text });
      }
    } else if (statuses && statuses.length) {
      for (const s of statuses) {
        logger.info('עדכון סטטוס הודעה יוצאת', { id: s.id, status: s.status, recipient: s.recipient_id });
      }
    } else {
      logger.warn('התקבלה קריאת webhook ללא הודעות/סטטוסים מזוהים', req.body);
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error('שגיאה בטיפול ב-webhook', err.message);
    res.sendStatus(200);
  }
});

app.post('/send', requireApiKey, async (req, res) => {
  const { toNumber, text } = req.body;
  if (!toNumber || !text) {
    return res.status(400).json({ error: 'toNumber and text are required' });
  }
  try {
    const data = await sendWhatsAppText({ toNumber, text });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send נכשל', details);
    res.status(500).json({ error: details });
  }
});

app.get('/logs', requireApiKey, (req, res) => {
  res.json({ logs: logger.getAll() });
});

app.post('/logs/clear', requireApiKey, (req, res) => {
  logger.clear();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

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