import axios from 'axios';
import FormData from 'form-data';
import { logger } from './logger.js';

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

function graphClient(accessToken) {
  return axios.create({
    baseURL: GRAPH_BASE,
    headers: {
      Authorization: `Bearer ${accessToken || process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * שליחת הודעת תבנית מאושרת - הדרך היחידה ליזום שיחה עם מספר שלא כתב
 * אליך ב-24 השעות האחרונות. בלי משתנים (התבנית start_conversation היא
 * משפט קבוע), ולכן אין components בכלל.
 */
export async function sendWhatsAppTemplate({ toNumber, templateName, languageCode = 'he' }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  logger.info('שולח הודעת תבנית (יזום שיחה)', { toNumber, templateName });
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    });
    logger.info('הודעת תבנית נשלחה בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('שליחת תבנית נכשלה', err.response?.data || err.message);
    throw err;
  }
}

/**
 * יזום שיחה **חינמי לגמרי**, דרך "מספר הבדיקה" (Test Number) שמטא נותנת
 * לכל אפליקציית Developer - לא דורש כרטיס אשראי, לא דורש billing eligibility.
 * מגבלה: עד 5 נמענים, וכל נמען חייב לעבור אימות חד-פעמי (קוד שמגיע לו
 * *בתוך* וואטסאפ עצמה) לפני שאפשר לשלוח אליו - זה נעשה ידנית פעם אחת
 * דרך developers.facebook.com, לא משהו שהקוד הזה עושה.
 * ההודעות יגיעו מהמספר האמריקאי של הבדיקה, לא מהמספר העסקי הרגיל.
 */
export async function sendTestConversationStarter({ toNumber, templateName, languageCode }) {
  // אם לא צוין שם תבנית מפורש, לוקחים מהגדרות השרת (WHATSAPP_TEST_TEMPLATE_NAME) -
  // כדי שאפשר יהיה לעבור לתבנית מותאמת אישית בלי לשנות קוד, רק env var.
  const finalTemplateName = templateName || process.env.WHATSAPP_TEST_TEMPLATE_NAME || 'hello_world';
  const finalLanguageCode = languageCode || process.env.WHATSAPP_TEST_TEMPLATE_LANG || 'en_US';
  const phoneNumberId = process.env.WHATSAPP_TEST_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_TEST_ACCESS_TOKEN; // אם לא מוגדר, ייפול חזרה לטוקן הרגיל
  const client = graphClient(accessToken);
  logger.info('שולח יזום שיחה חינמי דרך מספר הבדיקה', { toNumber, phoneNumberId, template: finalTemplateName });
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: finalTemplateName,
        language: { code: finalLanguageCode },
      },
    });
    logger.info('הודעת בדיקה נשלחה בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('שליחה ממספר הבדיקה נכשלה', err.response?.data || err.message);
    throw err;
  }
}

/**
 * מנויה (subscribe) את חשבון ה-WABA הנתון ל-webhook של האפליקציה, כדי
 * שהודעות שמגיעות אליו (למשל תגובות למספר הבדיקה) יתחילו להישלח אלינו.
 * זו פעולה בטוחה לחזור עליה שוב ושוב (idempotent) - לכן מריצים אותה
 * אוטומטית בכל עליית שרת, במקום לדרוש הרצה ידנית חד-פעמית ממישהו.
 */
export async function ensureWabaSubscribed(wabaId, accessToken) {
  if (!wabaId || !accessToken) return;
  try {
    const client = graphClient(accessToken);
    const { data } = await client.post(`/${wabaId}/subscribed_apps`);
    logger.info('חשבון WABA נרשם ל-webhook בהצלחה', { wabaId, data });
  } catch (err) {
    logger.error('הרשמת WABA ל-webhook נכשלה', { wabaId, error: err.response?.data || err.message });
  }
}

/** רישום המספר בפועל מול Cloud API (שלב טכני נדרש, נפרד מ-request_code/verify_code) */
export async function registerPhoneNumber({ pin = '123456' } = {}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  logger.info('רושם את המספר מול Cloud API', { phoneNumberId });
  try {
    const { data } = await client.post(`/${phoneNumberId}/register`, {
      messaging_product: 'whatsapp',
      pin,
    });
    logger.info('המספר נרשם בהצלחה מול Cloud API', data);
    return data;
  } catch (err) {
    logger.error('רישום המספר מול Cloud API נכשל', err.response?.data || err.message);
    throw err;
  }
}

/**
 * שלב 1 של רישום מספר: מבקש ממטא לשלוח קוד אימות (SMS או שיחה קולית)
 * למספר הטלפון המקושר ל-Phone Number ID הנתון.
 * זהו בדיוק ה"אני מקבל שיחה עם קוד" שתיארת - קורה מול ה-API, לא מול אפליקציה.
 */
export async function requestVerificationCode({ codeMethod = 'SMS' } = {}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  logger.info('בקשת קוד אימות ממטא', { phoneNumberId, codeMethod });
  try {
    const { data } = await client.post(`/${phoneNumberId}/request_code`, {
      code_method: codeMethod, // 'SMS' או 'VOICE'
      language: 'he',
    });
    logger.info('קוד אימות נשלח בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('בקשת קוד אימות נכשלה', err.response?.data || err.message);
    throw err;
  }
}

/** שלב 2: מאמת את הקוד שהוזן באתר מול מטא, ובכך "משלים" את רישום המספר */
export async function verifyCode({ code }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  logger.info('שולח קוד לאימות מול מטא', { phoneNumberId });
  try {
    const { data } = await client.post(`/${phoneNumberId}/verify_code`, { code });
    logger.info('המספר אומת בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('אימות הקוד נכשל', err.response?.data || err.message);
    throw err;
  }
}

/** שליחת הודעת טקסט יוצאת דרך ה-API הרשמי */
export async function sendWhatsAppText({ toNumber, text }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  logger.info('שולח הודעה יוצאת', { toNumber, textPreview: text?.slice(0, 40) });
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: toNumber, // בפורמט בינלאומי, בלי +, למשל 972501234567
      type: 'text',
      text: { body: text },
    });
    logger.info('הודעה נשלחה בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('שליחת הודעה נכשלה', err.response?.data || err.message);
    throw err;
  }
}

/**
 * מעלה קובץ (מ-base64) לשרתי מטא, ומחזיר media id שאיתו אפשר לשלוח הודעה.
 * זה שלב נפרד ונדרש - אי אפשר לשלוח קובץ ישירות בתוך הודעה, קודם "מפקידים" אותו.
 */
export async function uploadMedia({ base64, mimeType, filename }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const buffer = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, { filename: filename || 'file', contentType: mimeType });

  try {
    const { data } = await axios.post(`${GRAPH_BASE}/${phoneNumberId}/media`, form, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        ...form.getHeaders(),
      },
    });
    logger.info('קובץ מדיה הועלה בהצלחה', { mediaId: data.id, mimeType });
    return data.id;
  } catch (err) {
    logger.error('העלאת מדיה נכשלה', err.response?.data || err.message);
    throw err;
  }
}

/** שליחת הודעה יוצאת עם מדיה (תמונה/וידאו/מסמך) שכבר הועלתה, לפי media id */
export async function sendWhatsAppMedia({ toNumber, mediaId, type, caption }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  const mediaPayload = { id: mediaId };
  if (caption && type !== 'audio') mediaPayload.caption = caption; // audio לא תומך בכיתוב אצל מטא

  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: toNumber,
      type,
      [type]: mediaPayload,
    });
    logger.info('הודעת מדיה נשלחה בהצלחה', data);
    return data;
  } catch (err) {
    logger.error('שליחת מדיה נכשלה', err.response?.data || err.message);
    throw err;
  }
}
/**
 * מוריד תוכן מדיה (תמונה/הודעה קולית/וידאו) לפי mediaId שהתקבל ב-webhook.
 * זה תהליך דו-שלבי במטא: קודם מבקשים את ה-URL הזמני (בתוקף לכמה דקות),
 * ואז מורידים ממנו בפועל עם אותו טוקן הרשאה. מחזיר base64 כדי שאפשר
 * להעביר את זה בקלות דרך שכבות ה-proxy (Apps Script) בפורמט JSON רגיל.
 */
export async function getMediaAsBase64(mediaId) {
  const client = graphClient();
  const { data: meta } = await client.get(`/${mediaId}`);
  // meta: { url, mime_type, sha256, file_size, id }
  const binaryRes = await axios.get(meta.url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
  });
  const base64 = Buffer.from(binaryRes.data).toString('base64');
  return { mimeType: meta.mime_type, base64, fileSize: meta.file_size };
}
export async function markMessageAsRead({ messageId }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const client = graphClient();
  try {
    const { data } = await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
    logger.info('הודעה סומנה כנקראה', { messageId });
    return data;
  } catch (err) {
    logger.error('סימון הודעה כנקראה נכשל', err.response?.data || err.message);
    throw err;
  }
}