let settings = { scriptUrl: '', apiKey: '', defaultPrefix: '972', contactNames: {}, prefs: { readReceipts: true, sound: true, dark: false } };
let currentNumber = null;
let pollTimer = null;

async function init() {
  settings = await window.waSettings.get();
  // תאימות לאחור - משתמשים ותיקים שנשמרו לפני שהתווספו contactNames/prefs
  settings.contactNames = settings.contactNames || {};
  settings.prefs = { readReceipts: true, sound: true, dark: false, ...(settings.prefs || {}) };
  applyDarkMode();
  if (settings.scriptUrl && settings.apiKey) {
    document.getElementById('scriptUrl').value = settings.scriptUrl;
    document.getElementById('apiKey').value = settings.apiKey;
    document.getElementById('defaultPrefix').value = settings.defaultPrefix || '972';
    showApp();
  }
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const scriptUrl = document.getElementById('scriptUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  const defaultPrefix = document.getElementById('defaultPrefix').value;
  if (!scriptUrl || !apiKey) return;

  document.getElementById('settingsResult').textContent = 'בודק חיבור...';
  try {
    const res = await callApi({ action: 'health' }, scriptUrl, apiKey);
    if (!res.ok) throw new Error('תשובה לא תקינה מהשרת');
    settings = { ...settings, scriptUrl, apiKey, defaultPrefix };
    await window.waSettings.set(settings);
    showApp();
  } catch (err) {
    document.getElementById('settingsResult').textContent = '⚠️ החיבור נכשל: ' + err.message;
  }
});

// ממיר מספר מקומי (שמתחיל ב-0) לפורמט בינלאומי, לפי הקידומת שנבחרה בהגדרות
function normalizeNumber(raw) {
  const digits = raw.replace(/\D/g, '');
  const prefix = settings.defaultPrefix || '972';
  if (prefix === 'none') return digits; // המשתמש בחר להזין תמיד פורמט מלא
  if (digits.startsWith('0')) return prefix + digits.slice(1); // 0548477910 -> 972548477910
  if (digits.startsWith(prefix)) return digits; // כבר בפורמט בינלאומי
  return digits; // פורמט אחר/לא ברור - משאירים כמו שהוזן
}

document.getElementById('openSettings').addEventListener('click', () => {
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('settingsScreen').style.display = 'block';
  stopPolling();
});

function showApp() {
  document.getElementById('settingsScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';
  loadConversations();
  startPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    await loadConversations();
    if (currentNumber) {
      await loadMessages(currentNumber);
      if (settings.prefs.readReceipts) {
        callApi({ action: 'markRead', number: currentNumber }).catch(() => {});
      }
    }
  }, 5000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
}

async function callApi(params, scriptUrl, apiKey) {
  const url = new URL(scriptUrl || settings.scriptUrl);
  const allParams = { apiKey: apiKey || settings.apiKey, ...params };
  Object.entries(allParams).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

// גרסת POST - נדרשת לשליחת קבצים (base64 גדול מדי בשביל query string של GET).
// content-type נשאר text/plain בכוונה (לא application/json) כדי למנוע CORS
// preflight מול Apps Script - הוא לא בודק Content-Type, רק קורא את הגוף הגולמי.
async function callApiPost(body, scriptUrl, apiKey) {
  const url = scriptUrl || settings.scriptUrl;
  const payload = { apiKey: apiKey || settings.apiKey, ...body };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

let lastSeenTimes = new Map();
let conversationsInitialized = false;

async function loadConversations() {
  const data = await callApi({ action: 'conversations' });
  const list = data.conversations || [];
  list.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

  const box = document.getElementById('contactList');
  if (!list.length) {
    box.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">אין שיחות עדיין</div>';
    return;
  }
  box.innerHTML = list.map((c) => {
    const active = c.number === currentNumber ? 'active' : '';
    const displayName = settings.contactNames[c.number];
    return `<div class="contact ${active}" data-number="${c.number}">
      <div class="avatar">${String(c.number).slice(-2)}</div>
      <div class="cinfo">
        <div class="cnum">${displayName ? escapeHtml(displayName) : c.number}</div>
        <div class="clast">${(c.lastMessage || '').slice(0, 30)}</div>
      </div>
    </div>`;
  }).join('');

  // צליל התראה על הודעה נכנסת חדשה - רק אחרי טעינה ראשונית, כדי לא לצפצף על היסטוריה קיימת
  if (settings.prefs.sound) {
    for (const c of list) {
      const prevTime = lastSeenTimes.get(c.number);
      if (conversationsInitialized && c.lastDirection === 'in' && c.lastTime && c.lastTime !== prevTime) {
        playNotificationSound();
      }
      lastSeenTimes.set(c.number, c.lastTime);
    }
  } else {
    for (const c of list) lastSeenTimes.set(c.number, c.lastTime);
  }
  conversationsInitialized = true;

  box.querySelectorAll('.contact').forEach((el) => {
    el.addEventListener('click', () => selectConversation(el.dataset.number));
  });
}

async function selectConversation(number) {
  currentNumber = number;
  const displayName = settings.contactNames[number];
  document.getElementById('chatHeader').textContent = displayName ? `${displayName} (${number})` : 'שיחה עם ' + number;
  document.getElementById('msgInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('emojiBtn').disabled = false;
  document.getElementById('attachBtn').disabled = false;
  await loadConversations();
  await loadMessages(number);
  if (settings.prefs.readReceipts) {
    callApi({ action: 'markRead', number }).catch(() => {}); // לא חוסם את הממשק אם זה נכשל
  }
}

// מטמון תוכן מדיה שכבר הורד (מפתח: mediaId) - כדי לא להוריד מחדש בכל רענון
const mediaCache = new Map();

async function loadMessages(number) {
  const data = await callApi({ action: 'conversation', number });
  const messages = data.messages || [];
  const box = document.getElementById('messages');

  if (!messages.length) {
    box.innerHTML = '<div id="empty">אין הודעות עדיין</div>';
    return;
  }
  box.innerHTML = messages.map((m) => {
    const dir = m.direction === 'out' ? 'out' : 'in';
    const time = formatTime(m.time);
    const ticks = dir === 'out' ? renderTicks(m.status) : '';
    const isMedia = m.type && m.type !== 'text';
    const content = isMedia
      ? renderMediaContent(m)
      : `<div class="bubble">${escapeHtml(m.text)}</div>`;
    return `<div class="msg ${dir}">
      ${content}
      <div class="mtime">${time}${ticks}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// מרנדר בועת מדיה: אם כבר במטמון - מציג בפועל (img/audio/video/קישור הורדה),
// אחרת מציג כפתור "לחץ לטעינה" (טעינה לפי דרישה, לא אוטומטית לכל ההיסטוריה)
function renderMediaContent(m) {
  const cached = m.mediaId && mediaCache.get(m.mediaId);
  const caption = m.text ? `<div class="caption">${escapeHtml(m.text)}</div>` : '';

  if (cached) {
    const dataUrl = `data:${cached.mimeType};base64,${cached.base64}`;
    if (m.type === 'image') return `<div class="bubble media-bubble"><img class="media-img" src="${dataUrl}" alt="תמונה" />${caption}</div>`;
    if (m.type === 'audio') return `<div class="bubble media-bubble"><audio controls src="${dataUrl}"></audio>${caption}</div>`;
    if (m.type === 'video') return `<div class="bubble media-bubble"><video class="media-video" controls src="${dataUrl}"></video>${caption}</div>`;
    if (m.type === 'document') return `<div class="bubble media-bubble"><a class="doc-link" href="${dataUrl}" download>📄 שמור מסמך</a>${caption}</div>`;
  }
  const label = { image: '🖼️ תמונה', audio: '🎤 הודעה קולית', video: '🎥 סרטון', document: '📄 מסמך' }[m.type] || 'קובץ';
  return `<div class="bubble media-bubble">
    <button class="media-load-btn" data-media-id="${m.mediaId || ''}">${label} — לחץ לטעינה</button>
    ${caption}
  </div>`;
}

// טעינת מדיה לפי דרישה - קליק על כפתור בתוך ההודעות (delegation, כי ה-HTML מתחדש כל רענון)
document.getElementById('messages').addEventListener('click', async (e) => {
  const btn = e.target.closest('.media-load-btn');
  if (!btn || !currentNumber) return;
  const mediaId = btn.dataset.mediaId;
  if (!mediaId) return;
  btn.textContent = 'טוען...';
  btn.disabled = true;
  try {
    const data = await callApi({ action: 'media', mediaId });
    if (!data.ok || !data.base64) throw new Error('media fetch failed');
    mediaCache.set(mediaId, { mimeType: data.mimeType, base64: data.base64 });
    await loadMessages(currentNumber);
  } catch (err) {
    btn.textContent = '⚠ הטעינה נכשלה — לחץ לניסיון נוסף';
    btn.disabled = false;
  }
});

// מחזיר HTML של וי-ים לפי סטטוס ההודעה, בדיוק כמו בוואטסאפ:
// sent = וי אפורה אחת | delivered = שתי וי אפורות | read = שתי וי כחולות | failed = סימן אדום
function renderTicks(status) {
  if (status === 'failed') return ' <span class="tick tick-failed" title="השליחה נכשלה">⚠</span>';
  if (status === 'read') return ' <span class="tick tick-read" title="נקרא">✓✓</span>';
  if (status === 'delivered') return ' <span class="tick tick-delivered" title="נמסר">✓✓</span>';
  if (status === 'sent') return ' <span class="tick tick-sent" title="נשלח">✓</span>';
  return '';
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !currentNumber) return;
  input.value = '';
  await callApi({ action: 'send', toNumber: currentNumber, text });
  await loadConversations();
  await loadMessages(currentNumber);
}

document.getElementById('startNew').addEventListener('click', () => {
  const raw = document.getElementById('newNumber').value.trim();
  const number = normalizeNumber(raw);
  if (!number) return;
  document.getElementById('newNumber').value = '';
  selectConversation(number);
});

// "פתח שיחה" בתבנית - ליזום שיחה עם מספר שלא כתב ב-24 השעות האחרונות.
// שם התבנית קבוע כאן (start_conversation) - צריך שתהיה מאושרת אצל מטא לפני שזה יעבוד.
document.getElementById('startTemplate').addEventListener('click', async () => {
  const raw = document.getElementById('newNumber').value.trim();
  const number = normalizeNumber(raw);
  if (!number) return;
  const btn = document.getElementById('startTemplate');
  const original = btn.textContent;
  btn.textContent = 'שולח...';
  btn.disabled = true;
  try {
    const result = await callApi({ action: 'sendTemplate', toNumber: number, templateName: 'start_conversation' });
    if (!result.ok) throw new Error(JSON.stringify(result.data || result));
    document.getElementById('newNumber').value = '';
    await selectConversation(number);
  } catch (err) {
    alert('שליחת הודעת הפתיחה נכשלה - כנראה שהתבנית עדיין לא אושרה אצל מטא, או שגיאה אחרת:\n' + err.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});

// "קישור" - יוצר קישור wa.me מוכן (עם הודעה כתובה מראש), ומעתיק ללוח.
// אתה שולח אותו בעצמך בכל ערוץ שנוח (מייל אישי, SMS רגיל, בעל פה) - אין
// כאן שום שירות צד ג', אין אימות, ולא נראה חשוד כי זה מגיע ממך ולא מ"בוט".
// ברגע שהצד השני לוחץ על הקישור ושולח - חלון 24 השעות נפתח בחינם.
document.getElementById('getLink').addEventListener('click', async () => {
  const raw = document.getElementById('newNumber').value.trim();
  const number = normalizeNumber(raw);
  if (!number) return;
  const message = 'שלום! רציתי לדבר איתך בוואטסאפ - זה קישור שפותח שיחה איתי, רק צריך ללחוץ שלח 🙂';
  const link = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  try {
    await navigator.clipboard.writeText(link);
    alert('הקישור הועתק ללוח! (Ctrl+V כדי להדביק)\n\n' + link + '\n\nשלח אותו במייל האישי שלך, ב-SMS הרגיל, או תגיד לו בעל פה - ברגע שהוא ילחץ וישלח, השיחה תיפתח כאן.');
  } catch {
    prompt('העתק את הקישור ידנית (Ctrl+C):', link);
  }
});

// ---------- פאנל אימוג'ים ----------
const COMMON_EMOJIS = [
  '😀','😂','😍','😊','😉','😎','🥰','😘','🤔','😅','😢','😭','😡','😱','🥳','🙏',
  '👍','👎','👏','🙌','💪','🤝','✌️','👌','🤞','❤️','🧡','💛','💚','💙','💜','🖤',
  '🔥','⭐','✨','🎉','🎂','🎁','☕','🍕','🍔','🍺','⚽','🚗','✈️','🏠','📞','📸',
  '☀️','🌙','⏰','✅','❌','❓','❗','💯','🙈','🤣','😴','🤗','🤒','😇','🤦','🤷',
];

const emojiPanel = document.getElementById('emojiPanel');
emojiPanel.innerHTML = COMMON_EMOJIS.map((em) => `<span>${em}</span>`).join('');

document.getElementById('emojiBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('open');
});

emojiPanel.addEventListener('click', (e) => {
  if (e.target.tagName !== 'SPAN') return;
  const input = document.getElementById('msgInput');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + e.target.textContent + input.value.slice(end);
  const newPos = start + e.target.textContent.length;
  input.focus();
  input.setSelectionRange(newPos, newPos);
});

// סגירת הפאנל בלחיצה מחוץ לו
document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target.id !== 'emojiBtn') {
    emojiPanel.classList.remove('open');
  }
});

// ---------- מצב כהה ----------
function applyDarkMode() {
  document.body.classList.toggle('dark', !!settings.prefs.dark);
}

// ---------- צליל התראה (מיוצר ברגע, בלי קובץ שמע חיצוני) ----------
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* לא קריטי אם זה נכשל (למשל טאב לא פעיל) */ }
}

// ---------- מודל הגדרות אפליקציה (שמות אנשי קשר + העדפות) ----------
document.getElementById('openAppSettings').addEventListener('click', () => {
  document.getElementById('prefReadReceipts').checked = settings.prefs.readReceipts;
  document.getElementById('prefSound').checked = settings.prefs.sound;
  document.getElementById('prefDark').checked = settings.prefs.dark;
  renderContactNamesList();
  document.getElementById('appSettingsOverlay').classList.add('open');
});

function renderContactNamesList() {
  const container = document.getElementById('contactNamesList');
  const knownNumbers = Array.from(document.querySelectorAll('#contactList .contact')).map((el) => el.dataset.number);
  const allNumbers = Array.from(new Set([...knownNumbers, ...Object.keys(settings.contactNames)]));
  if (!allNumbers.length) {
    container.innerHTML = '<div style="font-size:12px;color:#999;">אין עדיין אנשי קשר - יופיעו כאן אחרי שיחה ראשונה</div>';
    return;
  }
  container.innerHTML = allNumbers.map((num) => `
    <div class="contact-name-row">
      <span class="cnr-number">${num}</span>
      <input type="text" data-number="${num}" placeholder="שם (לא חובה)" value="${escapeHtml(settings.contactNames[num] || '')}" />
    </div>
  `).join('');
}

document.getElementById('saveAppSettings').addEventListener('click', async () => {
  settings.prefs.readReceipts = document.getElementById('prefReadReceipts').checked;
  settings.prefs.sound = document.getElementById('prefSound').checked;
  settings.prefs.dark = document.getElementById('prefDark').checked;

  const newNames = {};
  document.querySelectorAll('#contactNamesList input').forEach((inp) => {
    const val = inp.value.trim();
    if (val) newNames[inp.dataset.number] = val;
  });
  settings.contactNames = newNames;

  await window.waSettings.set(settings);
  applyDarkMode();
  document.getElementById('appSettingsOverlay').classList.remove('open');
  await loadConversations();
  if (currentNumber) {
    const displayName = settings.contactNames[currentNumber];
    document.getElementById('chatHeader').textContent = displayName ? `${displayName} (${currentNumber})` : 'שיחה עם ' + currentNumber;
  }
});

document.getElementById('closeAppSettings').addEventListener('click', () => {
  document.getElementById('appSettingsOverlay').classList.remove('open');
});

init();

// ---------- שליחת קבצי מדיה (תמונה/וידאו/קול/מסמך) ----------
document.getElementById('attachBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // מאפשר לבחור שוב את אותו קובץ בפעם הבאה
  if (!file || !currentNumber) return;

  // מגבלת גודל של מטא: תמונות עד 5MB, וידאו/מסמכים עד 16MB
  if (file.size > 16 * 1024 * 1024) {
    alert('הקובץ גדול מדי (מעל 16MB) - וואטסאפ לא תאפשר לשלוח אותו');
    return;
  }

  const attachBtn = document.getElementById('attachBtn');
  const originalLabel = attachBtn.textContent;
  attachBtn.textContent = '⏳';
  attachBtn.disabled = true;

  try {
    const base64 = await fileToBase64(file);
    const caption = document.getElementById('msgInput').value.trim();
    const result = await callApiPost({
      action: 'sendMedia',
      toNumber: currentNumber,
      base64,
      mimeType: file.type || 'application/octet-stream',
      filename: file.name,
      caption,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.data || result));
    document.getElementById('msgInput').value = '';
    await loadMessages(currentNumber);
    await loadConversations();
  } catch (err) {
    alert('שליחת הקובץ נכשלה: ' + err.message);
  } finally {
    attachBtn.textContent = originalLabel;
    attachBtn.disabled = false;
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // מסיר את ה-prefix "data:...;base64,"
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
