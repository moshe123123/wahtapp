import nodemailer from 'nodemailer';
import { logger } from './logger.js';

const smtpPort = Number(process.env.SMTP_PORT || 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465, // 465 = SSL ישיר, 587 = STARTTLS (מומלץ יותר בסביבות ענן כמו Render)
  connectionTimeout: 15000, // עד 15 שניות לניסיון חיבור, במקום להיתקע בלי סוף
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: taggedTo,
      subject,
      text: body,
    });
    logger.info('מייל נשלח בהצלחה', { to: taggedTo, subject });
  } catch (err) {
    logger.error('שליחת מייל נכשלה', { to: taggedTo, error: err.message });
    throw err;
  }
}
