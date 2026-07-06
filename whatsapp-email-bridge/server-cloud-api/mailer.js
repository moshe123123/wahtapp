import nodemailer from 'nodemailer';
import { logger } from './logger.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
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
