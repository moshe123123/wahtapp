// לוגר פשוט: שומר את ה-N האירועים האחרונים בזיכרון, וגם מדפיס לקונסולה (כדי שיופיע בלוגים של Render).
// המטרה: אפשר יהיה לראות "מה קרה בפועל" מהאזור האישי, בלי לחפור בלוגים של Render עצמו.

const MAX_LOGS = 300;
const logs = [];

function push(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level, // 'info' | 'warn' | 'error'
    message,
    meta: meta ?? null,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();

  const line = `[${entry.time}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');

  return entry;
}

export const logger = {
  info: (message, meta) => push('info', message, meta),
  warn: (message, meta) => push('warn', message, meta),
  error: (message, meta) => push('error', message, meta),
  getAll: () => [...logs].reverse(), // החדש ביותר קודם
  clear: () => {
    logs.length = 0;
  },
};
