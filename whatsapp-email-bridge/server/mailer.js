import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * שולח מייל שמייצג הודעת וואטסאפ נכנסת.
 * כל שיחה (לפי מספר טלפון) מקבלת subject קבוע כדי ש-Gmail יקבץ אותה
 * לשרשור אחד, וכתובת plus-addressing שמזהה את המספר.
 */
export async function forwardWhatsAppMessageToEmail({ fromNumber, fromName, text, mediaUrl }) {
  const destBase = process.env.DESTINATION_EMAIL; // e.g. you@gmail.com
  const [localPart, domain] = destBase.split('@');
  const taggedTo = `${localPart}+wa_${fromNumber}@${domain}`;

  const subject = `[WA] ${fromName || fromNumber}`;

  const body = [
    `מאת: ${fromName || ''} (${fromNumber})`,
    '',
    text || '(הודעה ללא טקסט - ראה מדיה מצורפת אם קיימת)',
    mediaUrl ? `\nמדיה: ${mediaUrl}` : '',
    '',
    '---',
    `wa-thread-id:${fromNumber}`, // מזהה נסתר לזיהוי התוסף בכרום
  ].join('\n');

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: taggedTo,
    subject,
    text: body,
  });
}
