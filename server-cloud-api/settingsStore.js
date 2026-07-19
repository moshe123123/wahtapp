import Redis from 'ioredis';
import { logger } from './logger.js';

const SETTINGS_KEY = 'wa-bridge:settings';

let redisClient = null;

function getClient() {
  if (!redisClient && process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, {
      // Aiven דורש TLS (rediss://) - ioredis מזהה את זה אוטומטית מה-URL,
      // אבל מוסיפים גם כאן ליתר ביטחון
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 3,
    });
    redisClient.on('error', (err) => logger.error('שגיאת חיבור Redis', err.message));
  }
  return redisClient;
}

/** שולף את הגדרות המשתמש השמורות (שמות אנשי קשר, העדפות וכו') */
export async function getSettings() {
  const client = getClient();
  if (!client) return null; // REDIS_URL לא מוגדר - פיצ'ר הסנכרון פשוט לא פעיל
  try {
    const raw = await client.get(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    logger.error('קריאת הגדרות מ-Redis נכשלה', err.message);
    return null;
  }
}

/** שומר את הגדרות המשתמש (דורס את הקיים - הלקוח שולח את האובייקט המלא) */
export async function saveSettings(settings) {
  const client = getClient();
  if (!client) return false;
  try {
    await client.set(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    logger.error('שמירת הגדרות ל-Redis נכשלה', err.message);
    return false;
  }
}
