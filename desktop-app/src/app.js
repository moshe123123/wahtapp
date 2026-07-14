let settings = { scriptUrl: '', apiKey: '', defaultPrefix: '972' };
let currentNumber = null;
let pollTimer = null;

async function init() {
  settings = await window.waSettings.get();
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
    settings = { scriptUrl, apiKey, defaultPrefix };
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
      callApi({ action: 'markRead', number: currentNumber }).catch(() => {});
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
    return `<div class="contact ${active}" data-number="${c.number}">
      <div class="avatar">${String(c.number).slice(-2)}</div>
      <div class="cinfo">
        <div class="cnum">${c.number}</div>
        <div class="clast">${(c.lastMessage || '').slice(0, 30)}</div>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.contact').forEach((el) => {
    el.addEventListener('click', () => selectConversation(el.dataset.number));
  });
}

async function selectConversation(number) {
  currentNumber = number;
  document.getElementById('chatHeader').textContent = 'שיחה עם ' + number;
  document.getElementById('msgInput').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  await loadConversations();
  await loadMessages(number);
  callApi({ action: 'markRead', number }).catch(() => {}); // לא חוסם את הממשק אם זה נכשל
}

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
    return `<div class="msg ${dir}">
      <div class="bubble">${escapeHtml(m.text)}</div>
      <div class="mtime">${time}${ticks}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

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

init();
