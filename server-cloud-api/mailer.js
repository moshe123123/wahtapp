import axios from 'axios';
import { logger } from './logger.js';

/**
 * שולח מייל דרך Resend API (HTTPS, פורט 443) במקום SMTP ישיר.
 * הסיבה: הרבה ספקי אחסון חינמיים (כולל Render) חוסמים יציאה בפורטי SMTP (25/465/587)
 * כדי למנוע ניצול לרעה לספאם. HTTPS כמעט אף פעם לא חסום.
 */
export async function forwardWhatsAppMessageToEmail({ fromNumber, fromName, text }) {
  const destinationEmail = process.env.DESTINATION_EMAIL; // שליחה ישירה, בלי plus-addressing -
  // ב-Resend (מצב בדיקה בלי דומיין מאומת) אפשר לשלוח רק בדיוק לכתובת שנרשמה,
  // וכל תוספת (כמו +wa_123) נחשבת "כתובת אחרת" ונדחית.

  const subject = `[WA] ${fromName || fromNumber}`;

  const body = [
    `מאת: ${fromName || ''} (${fromNumber})`,
    '',
    text || '(הודעה ללא טקסט)',
    '',
    '---',
    `wa-thread-id:${fromNumber}`, // הסימון הזה עדיין מזהה את השיחה עבור תוסף הכרום
  ].join('\n');

  try {
    await axios.post(
      'https://api.resend.com/emails',
      {
        from: 'onboarding@resend.dev',
        to: [destinationEmail],
        subject,
        text: body,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info('מייל נשלח בהצלחה (Resend)', { to: destinationEmail, subject });
  } catch (err) {
    logger.error('שליחת מייל נכשלה (Resend)', {
      to: destinationEmail,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}
