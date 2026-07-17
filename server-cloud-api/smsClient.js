import axios from 'axios';
import { logger } from './logger.js';

/**
 * שולח SMS רגיל (לא וואטסאפ!) שמבקש מהנמען לשלוח הודעת וואטסאפ ראשונה.
 * זה עוקף לגמרי את דרישת התשלום/התבנית של מטא - כי זו לא הודעת וואטסאפ
 * יזומה בכלל, זה רק "הזמנה" בערוץ אחר. ברגע שהנמען כותב בפועל בוואטסאפ,
 * חלון 24 השעות נפתח כרגיל ובחינם.
 *
 * הערה חשובה: בחשבון Twilio מסוג Trial (חינמי) ניתן לשלוח רק למספרים
 * שאומתו מראש בקונסולת Twilio (Verified Caller IDs) - זה מתאים מצוין
 * לשימוש אישי מול קבוצת אנשי קשר קבועה (לא שיווק המוני).
 */
export async function sendOpeningRequestSms({ toNumber, senderName }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  const body =
    `שלום! ${senderName || 'מישהו'} מבקש לדבר איתך בוואטסאפ - ` +
    `שלח/י לו הודעה קצרה בוואטסאפ כדי לפתוח את השיחה 🙂`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams();
  params.append('To', `+${toNumber}`);
  params.append('From', fromNumber);
  params.append('Body', body);

  try {
    const { data } = await axios.post(url, params, {
      auth: { username: accountSid, password: authToken },
    });
    logger.info('SMS בקשת פתיחה נשלח', { toNumber, sid: data.sid });
    return data;
  } catch (err) {
    logger.error('שליחת SMS בקשת פתיחה נכשלה', err.response?.data || err.message);
    throw err;
  }
}
