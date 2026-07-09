import axios from 'axios';
import { logger } from './logger.js';

/**
 * שולח מייל דרך Resend API (HTTPS, פורט 443) במקום SMTP ישיר.
 * הסיבה: הרבה ספקי אחסון חינמיים (כולל Render) חוסמים יציאה בפורטי SMTP (25/465/587)
 * כדי למנוע ניצול לרעה לספאם. HTTPS כמעט אף פעם לא חסום.
 */
export async function forwardWhatsAppMessageToEmail({ fromNumber, fromName, text }) {
  const destBase = process.env.DESTINATION_EMAIL;
  const [localPart, domain] = destBase.split('@');
  const taggedTo = `${localPart}+wa_${fromNumber}@${domain}`;

  const subject = `[WA] ${fromName || fromNumber}`;

  const body = [
    `מאת: ${fromName || ''} (${fromNumber})`,
    '',
    text || '(הודעה ללא טקסט)',
    '',
    '---',
    `wa-thread-id:${fromNumber}`,
  ].join('\n');

  try {
    await axios.post(
      'https://api.resend.com/emails',
      {
        from: 'onboarding@resend.dev', // כתובת בדיקה מובנית של Resend, לא דורשת אימות דומיין
        to: [taggedTo],
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
    logger.info('מייל נשלח בהצלחה (Resend)', { to: taggedTo, subject });
  } catch (err) {
    logger.error('שליחת מייל נכשלה (Resend)', {
      to: taggedTo,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}
