import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestVerificationCode, verifyCode, sendWhatsAppText, registerPhoneNumber, markMessageAsRead, getMediaAsBase64, uploadMedia, sendWhatsAppMedia, sendWhatsAppTemplate, sendTestConversationStarter } from './whatsappClient.js';
import { forwardWhatsAppMessageToEmail } from './mailer.js';
import { sendOpeningRequestSms } from './smsClient.js';
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

function addMessageToConversation(number, direction, text, id, extra = {}) {
  if (!conversations.has(number)) conversations.set(number, []);
  const list = conversations.get(number);
  // direction: 'in' | 'out'. status רלוונטי רק ל-'out': sent -> delivered -> read (או failed)
  // type: 'text' (ברירת מחדל) | 'image' | 'audio' | 'video' | 'document'
  // עבור מדיה: mediaId הוא מזהה המדיה אצל מטא (לא הבינארי עצמו - זה נשלף לפי דרישה דרך /media/:id)
  list.push({
    id: id || null,
    direction,
    text,
    type: extra.type || 'text',
    mediaId: extra.mediaId || null,
    mimeType: extra.mimeType || null,
    time: new Date().toISOString(),
    status: direction === 'out' ? 'sent' : undefined,
  });
  if (list.length > 200) list.shift(); // הגבלת גודל למניעת גדילה אינסופית
  return list[list.length - 1];
}

// מעדכן את הסטטוס (delivered/read/failed) של הודעה יוצאת ספציפית, לפי ה-wamid שחוזר מ-Meta
function updateMessageStatus(wamid, status) {
  for (const list of conversations.values()) {
    const msg = list.find((m) => m.id === wamid);
    if (msg) {
      // לא "מדרגים" סטטוס אחורה (למשל read שמגיע אחרי delivered לא אמור לחזור ל-sent)
      const rank = { sent: 1, delivered: 2, read: 3, failed: 1 };
      if (!msg.status || rank[status] >= rank[msg.status]) msg.status = status;
      return true;
    }
  }
  return false;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '25mb' })); // הוגדל כדי לתמוך בהעלאת תמונות/סרטונים כ-base64

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

        // הודעות טקסט לעומת מדיה (תמונה/הודעה קולית/וידאו/מסמך) - מבנה שונה ב-webhook לכל סוג
        const mediaTypes = ['image', 'audio', 'video', 'document'];
        if (mediaTypes.includes(msg.type)) {
          const mediaObj = msg[msg.type]; // msg.image / msg.audio / msg.video / msg.document
          const caption = mediaObj?.caption || '';
          logger.info('התקבלה הודעת מדיה נכנסת', { fromNumber, type: msg.type, mediaId: mediaObj?.id });
          addMessageToConversation(fromNumber, 'in', caption, msg.id, {
            type: msg.type,
            mediaId: mediaObj?.id,
            mimeType: mediaObj?.mime_type,
          });
          const label = { image: 'תמונה', audio: 'הודעה קולית', video: 'סרטון', document: 'מסמך' }[msg.type];
          await forwardWhatsAppMessageToEmail({ fromNumber, fromName, text: `[${label}] ${caption}` });
          await forwardToAppsScript(fromNumber, fromName, `[${label}] ${caption}`);
          continue;
        }

        const text = msg.text?.body || '';
        logger.info('התקבלה הודעת וואטסאפ נכנסת', { fromNumber, fromName, text });
        addMessageToConversation(fromNumber, 'in', text, msg.id);
        await forwardWhatsAppMessageToEmail({ fromNumber, fromName, text });
        await forwardToAppsScript(fromNumber, fromName, text);
      }
    } else if (statuses && statuses.length) {
      // עדכוני סטטוס (נשלח/נמסר/נקרא) - אלה הוי-ים שרואים בממשק
      for (const s of statuses) {
        logger.info('עדכון סטטוס הודעה יוצאת', { id: s.id, status: s.status, recipient: s.recipient_id });
        const found = updateMessageStatus(s.id, s.status); // 'sent' | 'delivered' | 'read' | 'failed'
        if (!found) logger.warn('עדכון סטטוס להודעה שלא נמצאה במאגר (id ישן/restart)', s.id);
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
    const wamid = data?.messages?.[0]?.id || null;
    addMessageToConversation(toNumber, 'out', text, wamid);
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send נכשל', details);
    // גם שליחה שנכשלה נרשמת בהיסטוריה, עם סטטוס failed - כדי שהמשתמש יראה שזה לא הגיע
    const failedMsg = addMessageToConversation(toNumber, 'out', text, null);
    failedMsg.status = 'failed';
    res.status(500).json({ error: details });
  }
});

// שליחת הודעת תבנית מאושרת - ליזום שיחה עם מספר שלא כתב ב-24 השעות האחרונות
app.post('/send-template', requireApiKey, async (req, res) => {
  const { toNumber, templateName, languageCode } = req.body || {};
  if (!toNumber || !templateName) {
    return res.status(400).json({ error: 'toNumber ו-templateName הם שדות חובה' });
  }
  try {
    const data = await sendWhatsAppTemplate({ toNumber, templateName, languageCode });
    const wamid = data?.messages?.[0]?.id || null;
    addMessageToConversation(toNumber, 'out', `[הודעת פתיחה: ${templateName}]`, wamid);
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send-template נכשל', details);
    const failedMsg = addMessageToConversation(toNumber, 'out', `[הודעת פתיחה: ${templateName}]`, null);
    failedMsg.status = 'failed';
    res.status(500).json({ error: details });
  }
});

// יזום שיחה חינמי לגמרי, דרך מספר הבדיקה (Test Number) של מטא - עד 5
// נמענים, כל אחד חייב אימות חד-פעמי מראש דרך developers.facebook.com
app.post('/send-test-conversation', requireApiKey, async (req, res) => {
  const { toNumber } = req.body || {};
  if (!toNumber) {
    return res.status(400).json({ error: 'toNumber הוא שדה חובה' });
  }
  try {
    const data = await sendTestConversationStarter({ toNumber });
    const wamid = data?.messages?.[0]?.id || null;
    addMessageToConversation(toNumber, 'out', '[יזום שיחה - מספר בדיקה חינמי]', wamid);
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send-test-conversation נכשל', details);
    const failedMsg = addMessageToConversation(toNumber, 'out', '[יזום שיחה - מספר בדיקה חינמי]', null);
    failedMsg.status = 'failed';
    res.status(500).json({ error: details });
  }
});

// בקשת פתיחת שיחה דרך SMS (לא וואטסאפ!) - עוקף לגמרי את דרישת התשלום/
// התבנית של מטא. שולח SMS רגיל שמבקש מהנמען לכתוב הודעת וואטסאפ ראשונה.
app.post('/request-open', requireApiKey, async (req, res) => {
  const { toNumber, senderName } = req.body || {};
  if (!toNumber) {
    return res.status(400).json({ error: 'toNumber הוא שדה חובה' });
  }
  try {
    const data = await sendOpeningRequestSms({ toNumber, senderName });
    addMessageToConversation(toNumber, 'out', '[נשלחה בקשת פתיחה ב-SMS]', null);
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /request-open נכשל', details);
    res.status(500).json({ error: details });
  }
});

// מסמן את כל ההודעות הנכנסות שטרם סומנו כ"נקראו" עבור מספר מסוים - נקרא כשפותחים שיחה בממשק
app.post('/conversations/:number/mark-read', requireApiKey, async (req, res) => {
  const number = req.params.number;
  const list = conversations.get(number) || [];
  const unread = list.filter((m) => m.direction === 'in' && m.id && !m.readByUs);
  for (const msg of unread) {
    try {
      await markMessageAsRead({ messageId: msg.id });
      msg.readByUs = true;
    } catch (err) {
      logger.error('סימון כנקרא נכשל עבור הודעה', msg.id);
    }
  }
  res.json({ ok: true, marked: unread.length });
});

// ---------- שיחות: ממשק התכתבות פשוט מהאזור האישי ----------

// רשימת מספרים שיש איתם שיחה (לתפריט בחירה)
app.get('/conversations', requireApiKey, (req, res) => {
  const list = [...conversations.keys()].map((number) => {
    const msgs = conversations.get(number);
    const last = msgs[msgs.length - 1];
    return { number, lastMessage: last?.text, lastTime: last?.time, lastDirection: last?.direction };
  });
  res.json({ conversations: list });
});

// היסטוריית הודעות עם מספר ספציפי
app.get('/conversations/:number', requireApiKey, (req, res) => {
  const messages = conversations.get(req.params.number) || [];
  res.json({ messages });
});

// שליחת קובץ מדיה (תמונה/וידאו/מסמך/קול) - הגוף כולל את הקובץ בפורמט base64
// body: { toNumber, base64, mimeType, filename, caption }
app.post('/send-media', requireApiKey, async (req, res) => {
  const { toNumber, base64, mimeType, filename, caption } = req.body || {};
  if (!toNumber || !base64 || !mimeType) {
    return res.status(400).json({ error: 'toNumber, base64 ו-mimeType הם שדות חובה' });
  }
  const type = mimeType.startsWith('image/') ? 'image'
    : mimeType.startsWith('video/') ? 'video'
    : mimeType.startsWith('audio/') ? 'audio'
    : 'document';

  try {
    const mediaId = await uploadMedia({ base64, mimeType, filename });
    const data = await sendWhatsAppMedia({ toNumber, mediaId, type, caption });
    const wamid = data?.messages?.[0]?.id || null;
    addMessageToConversation(toNumber, 'out', caption || '', wamid, { type, mediaId, mimeType });
    res.json({ ok: true, data });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /send-media נכשל', details);
    const failedMsg = addMessageToConversation(toNumber, 'out', caption || '', null, { type, mimeType });
    failedMsg.status = 'failed';
    res.status(500).json({ error: details });
  }
});

// הורדת תוכן מדיה בפועל (תמונה/קול/וידאו/מסמך) לפי mediaId - נקרא רק כשרוצים
// להציג/להשמיע בפועל, כדי לא להעמיס את טעינת השיחה הראשונית בקבצים כבדים
app.get('/media/:mediaId', requireApiKey, async (req, res) => {
  try {
    const result = await getMediaAsBase64(req.params.mediaId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('route /media נכשל', details);
    res.status(500).json({ error: details });
  }
});

// ---------- לוגים: לצפייה מהאזור האישי ----------
app.get('/logs', requireApiKey, (req, res) => {
  res.json({ logs: logger.getAll() });
});

app.post('/logs/clear', requireApiKey, (req, res) => {
  logger.clear();
  res.json({ ok: true });
});

// ---------- קליטת התראות מקבוצת וואטסאפ (מכשיר אנדרואיד נוסף + אפליקציית
// notification-forwarder כמו BigShoots/NotificationWebhookApp) ----------
// זה לא ה-Cloud API הרשמי בכלל - זו רק "קריאת התראה" ממכשיר אמיתי, ולכן
// אין כאן שום סיכון חסימה. מוגן במפתח נפרד (לא ה-API_KEY הראשי) כי הכתובת
// הזו חייבת להיות מוטבעת בתוך הגדרות אפליקציה חיצונית (לא בשליטתנו).
// מזהה השיחה בממשק יהיה קבוע: 'family-group' (אפשר לתת לו שם תצוגה
// "קבוצה משפחתית" דרך הגדרות אנשי הקשר שכבר קיימות באפליקציה).
app.post('/family-notify', (req, res) => {
  const key = req.query.key || req.body?.key;
  if (!process.env.FAMILY_WEBHOOK_KEY || key !== process.env.FAMILY_WEBHOOK_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // מבנה ה-JSON משתנה קצת בין אפליקציות forwarder שונות - מנסים כמה שמות שדה נפוצים
  const body = req.body || {};
  const appName = body.app || body.packageName || body.package || '';
  const title = body.title || body.sender || '';
  const text = body.text || body.message || body.content || body.bigText || '';

  // מסננים החוצה התראות שהן לא מוואטסאפ, אם השדה קיים
  if (appName && !String(appName).toLowerCase().includes('whatsapp')) {
    return res.json({ ok: true, skipped: true });
  }

  const combinedText = title ? `${title}: ${text}` : text;
  logger.info('התקבלה התראת קבוצה משפחתית', { title, text });
  addMessageToConversation('family-group', 'in', combinedText || '(התראה ללא טקסט)', null);
  forwardWhatsAppMessageToEmail({ fromNumber: 'family-group', fromName: 'קבוצה משפחתית', text: combinedText }).catch(() => {});
  res.json({ ok: true });
});

// endpoint חד-פעמי: מקבל את ה-code שהתקבל מתהליך ה-Embedded Signup (Coexistence)
// ומחליף אותו בטוקן דרך Graph API, כדי לראות אילו נכסים (WABA/מספר) התקבלו בפועל
app.post('/coexistence/exchange', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;
    if (!code) return res.status(400).json({ error: 'חסר code בבקשה' });

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(500).json({ error: 'חסרים METAAPP_ID / META_APP_SECRET במשתני הסביבה של השרת' });
    }

    const { data } = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri,
      },
    });

    logger.info('תוצאת החלפת קוד Coexistence: ' + JSON.stringify(data));
    res.json(data);
  } catch (err) {
    const details = err.response?.data || err.message;
    logger.error('שגיאה בהחלפת קוד Coexistence: ' + JSON.stringify(details));
    res.status(500).json({ error: details });
  }
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
