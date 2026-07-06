import axios from 'axios';
import { logger } from './logger.js';

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

function graphClient() {
  return axios.create({
    baseURL: GRAPH_BASE,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
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