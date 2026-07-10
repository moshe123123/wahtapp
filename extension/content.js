// ============ תוסף גשר וואטסאפ ל-Gmail - ממשק צ'אט מלא ============

let settingsCache = null;
let currentNumber = null;
let conversationsCache = [];
let panelOpen = false;
let pollTimer = null;

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['serverUrl', 'apiKey', 'displayMode'], (data) => {
      settingsCache = {
        serverUrl: data.serverUrl || '',
        apiKey: data.apiKey || '',
        displayMode: data.displayMode || 'both', // 'both' | 'extensionOnly' | 'emailOnly'
      };
      resolve(settingsCache);
    });
  });
}

async function apiFetch(path, options = {}) {
  const { serverUrl, apiKey } = await getSettings();
  if (!serverUrl || !apiKey) throw new Error('חסרים הגדרות שרת/מפתח API בתוסף');
  const res = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
  return res.json();
}

// ============ אייקון צף בעמודה הימנית (מיקום ויזואלי כמו Mail/Chat/Meet) ============
function ensureToggleButton() {
  if (document.getElementById('wa-bridge-rail-icon')) return;
  const wrap = document.createElement('div');
  wrap.id = 'wa-bridge-rail-icon';
  wrap.innerHTML = `
    <div class="wa-rail-circle">💬</div>
    <div class="wa-rail-label">WA</div>
  `;
  wrap.title = 'פתח את גשר הוואטסאפ';
  wrap.addEventListener('click', togglePanel);
  document.body.appendChild(wrap);
}

function togglePanel() {
  panelOpen = !panelOpen;
  if (!panelOpen) {
    closePanel();
    return;
  }
  renderPanel();
  startPolling();
}

function closePanel() {
  const el = document.getElementById('wa-bridge-panel');
  if (el) el.remove();
  stopPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    await refreshConversationList();
    if (currentNumber) await refreshMessages(currentNumber);
  }, 5000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ============ בניית הפאנל ============
function renderPanel() {
  const old = document.getElementById('wa-bridge-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'wa-bridge-panel';
  panel.innerHTML = `
    <div class="wa-p-header">
      <span>💬 גשר וואטסאפ</span>
      <div>
        <span class="wa-icon-btn" id="wa-p-settings" title="הגדרות">⚙️</span>
        <span class="wa-icon-btn" id="wa-p-close" title="סגור">✕</span>
      </div>
    </div>
    <div class="wa-p-body">
      <div class="wa-p-sidebar">
        <div class="wa-p-newchat">
          <input type="text" id="wa-new-number" placeholder="מספר חדש (972...)" />
          <button id="wa-new-start">התחל</button>
        </div>
        <div id="wa-p-contacts" class="wa-p-contacts"></div>
      </div>
      <div class="wa-p-chat">
        <div class="wa-p-chat-header" id="wa-p-chat-header">בחר שיחה מהרשימה, או התחל שיחה חדשה</div>
        <div class="wa-p-messages" id="wa-p-messages"></div>
        <div class="wa-p-inputrow">
          <input type="text" id="wa-p-input" placeholder="הקלד הודעה..." disabled />
          <button id="wa-p-send" disabled>שלח</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('wa-p-close').addEventListener('click', togglePanel);
  document.getElementById('wa-p-settings').addEventListener('click', toggleSettingsPanel);
  document.getElementById('wa-new-start').addEventListener('click', startNewConversation);
  document.getElementById('wa-p-send').addEventListener('click', sendCurrentMessage);
  document.getElementById('wa-p-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendCurrentMessage();
  });

  refreshConversationList();

  // אם כבר זוהתה שיחה מהמייל הפתוח כרגע - פתח אותה ישר
  const detected = findThreadNumberOnPage();
  if (detected) selectConversation(detected);
}

// ============ רשימת אנשי קשר ============
async function refreshConversationList() {
  try {
    const data = await apiFetch('/conversations');
    conversationsCache = data.conversations || [];
    renderContactList();
  } catch (err) {
    const box = document.getElementById('wa-p-contacts');
    if (box) box.innerHTML = `<div class="wa-error">⚠️ ${err.message}</div>`;
  }
}

function renderContactList() {
  const box = document.getElementById('wa-p-contacts');
  if (!box) return;
  if (!conversationsCache.length) {
    box.innerHTML = '<div class="wa-muted">אין שיחות עדיין</div>';
    return;
  }
  box.innerHTML = conversationsCache
    .map((c) => {
      const active = c.number === currentNumber ? 'active' : '';
      const time = c.lastTime ? formatTime(c.lastTime) : '';
      return `
      <div class="wa-contact ${active}" data-number="${c.number}">
        <div class="wa-contact-avatar">${(c.number || '?').slice(-2)}</div>
        <div class="wa-contact-info">
          <div class="wa-contact-number">${c.number}</div>
          <div class="wa-contact-last">${(c.lastMessage || '').slice(0, 28)}</div>
        </div>
        <div class="wa-contact-time">${time}</div>
      </div>`;
    })
    .join('');

  box.querySelectorAll('.wa-contact').forEach((el) => {
    el.addEventListener('click', () => selectConversation(el.dataset.number));
  });
}

// ============ שיחה נבחרת ============
async function selectConversation(number) {
  currentNumber = number;
  document.getElementById('wa-p-input').disabled = false;
  document.getElementById('wa-p-send').disabled = false;
  document.getElementById('wa-p-chat-header').textContent = `שיחה עם ${number}`;
  renderContactList();
  await refreshMessages(number);
}

async function refreshMessages(number) {
  try {
    const data = await apiFetch(`/conversations/${number}`);
    renderMessages(data.messages || []);
  } catch (err) {
    // שקט - זו יכולה להיות שיחה חדשה שעוד אין לה היסטוריה
  }
}

function renderMessages(messages) {
  const box = document.getElementById('wa-p-messages');
  if (!box) return;
  if (!messages.length) {
    box.innerHTML = '<div class="wa-muted">אין הודעות עדיין בשיחה זו.</div>';
    return;
  }
  box.innerHTML = messages
    .map((m) => {
      const align = m.direction === 'out' ? 'out' : 'in';
      const time = formatTime(m.time);
      return `
      <div class="wa-msg wa-msg-${align}">
        <div class="wa-msg-bubble">${escapeHtml(m.text)}</div>
        <div class="wa-msg-time">${time}</div>
      </div>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ============ שליחה ============
async function sendCurrentMessage() {
  const input = document.getElementById('wa-p-input');
  const text = input.value.trim();
  if (!text || !currentNumber) return;
  input.value = '';
  try {
    await apiFetch('/send', {
      method: 'POST',
      body: JSON.stringify({ toNumber: currentNumber, text }),
    });
    await refreshConversationList();
    await refreshMessages(currentNumber);
  } catch (err) {
    alert(`שגיאה בשליחה: ${err.message}`);
  }
}

async function startNewConversation() {
  const input = document.getElementById('wa-new-number');
  const number = input.value.trim().replace(/\D/g, '');
  if (!number) return;
  input.value = '';
  await selectConversation(number);
}

// ============ זיהוי שרשור מייל פתוח (לפתיחה אוטומטית) ============
const THREAD_MARKER = /wa-thread-id:(\d+)/;
function findThreadNumberOnPage() {
  const bodyText = document.body.innerText || '';
  const match = bodyText.match(THREAD_MARKER);
  return match ? match[1] : null;
}

// ============ פאנל הגדרות ============
async function toggleSettingsPanel() {
  const existing = document.getElementById('wa-settings-panel');
  if (existing) {
    existing.remove();
    return;
  }
  const { serverUrl, apiKey, displayMode } = await getSettings();
  const opts = await getExtraSettings();

  const panel = document.createElement('div');
  panel.id = 'wa-settings-panel';
  panel.innerHTML = `
    <div class="wa-settings-header">
      <span>⚙️ הגדרות</span>
      <span class="wa-icon-btn" id="wa-settings-close">✕</span>
    </div>
    <div class="wa-settings-body">
      <label>כתובת השרת
        <input id="s-serverUrl" value="${serverUrl}" placeholder="https://your-app.onrender.com" />
      </label>
      <label>מפתח API
        <input id="s-apiKey" type="password" value="${apiKey}" />
      </label>

      <div class="wa-settings-section">היכן להציג הודעות נכנסות?</div>
      <label class="wa-radio"><input type="radio" name="displayMode" value="both" ${displayMode === 'both' ? 'checked' : ''}/> גם מייל וגם ממשק התוסף (ברירת מחדל)</label>
      <label class="wa-radio"><input type="radio" name="displayMode" value="extensionOnly" ${displayMode === 'extensionOnly' ? 'checked' : ''}/> ממשק התוסף בלבד</label>
      <label class="wa-radio"><input type="radio" name="displayMode" value="emailOnly" ${displayMode === 'emailOnly' ? 'checked' : ''}/> מייל בלבד</label>

      <div class="wa-settings-section">אפשרויות נוספות</div>
      <label class="wa-checkbox"><input type="checkbox" id="s-notifSound" ${opts.notifSound ? 'checked' : ''}/> צליל התראה בהודעה חדשה</label>
      <label class="wa-checkbox"><input type="checkbox" id="s-desktopNotif" ${opts.desktopNotif ? 'checked' : ''}/> התראת דסקטופ</label>
      <label>קצב רענון אוטומטי (שניות)
        <input id="s-refreshSec" type="number" min="3" value="${opts.refreshSec || 5}" />
      </label>
      <label class="wa-checkbox"><input type="checkbox" id="s-darkTheme" ${opts.darkTheme ? 'checked' : ''}/> ערכת נושא כהה</label>

      <button id="wa-settings-save">💾 שמור הגדרות</button>
      <div class="wa-result" id="wa-settings-result"></div>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById('wa-settings-close').addEventListener('click', () => panel.remove());
  document.getElementById('wa-settings-save').addEventListener('click', async () => {
    const newServerUrl = document.getElementById('s-serverUrl').value.trim();
    const newApiKey = document.getElementById('s-apiKey').value.trim();
    const newDisplayMode = panel.querySelector('input[name="displayMode"]:checked').value;
    const notifSound = document.getElementById('s-notifSound').checked;
    const desktopNotif = document.getElementById('s-desktopNotif').checked;
    const refreshSec = Number(document.getElementById('s-refreshSec').value) || 5;
    const darkTheme = document.getElementById('s-darkTheme').checked;

    await new Promise((resolve) => {
      chrome.storage.sync.set(
        { serverUrl: newServerUrl, apiKey: newApiKey, displayMode: newDisplayMode, notifSound, desktopNotif, refreshSec, darkTheme },
        resolve
      );
    });
    document.getElementById('wa-settings-result').textContent = '✅ נשמר!';
    document.body.classList.toggle('wa-dark', darkTheme);
    setTimeout(() => panel.remove(), 800);
  });
}

function getExtraSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['notifSound', 'desktopNotif', 'refreshSec', 'darkTheme'], resolve);
  });
}

// ============ אתחול ============
function scanAndUpdate() {
  ensureToggleButton();
}

const observer = new MutationObserver(() => scanAndUpdate());
observer.observe(document.body, { childList: true, subtree: true });

scanAndUpdate();
