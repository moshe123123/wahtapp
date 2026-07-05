// מזהה שרשור וואטסאפ לפי הסימון הנסתר שהשרת מוסיף בגוף המייל: "wa-thread-id:<number>"
const THREAD_MARKER = /wa-thread-id:(\d+)/;

let currentThreadNumber = null;
let panelEl = null;

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['serverUrl', 'apiKey'], resolve);
  });
}

function findThreadNumberOnPage() {
  // סורק את תוכן העמוד הנוכחי (השרשור הפתוח) בחיפוש אחר הסימון
  const bodyText = document.body.innerText || '';
  const match = bodyText.match(THREAD_MARKER);
  return match ? match[1] : null;
}

function ensureToggleButton() {
  if (document.getElementById('wa-bridge-toggle')) return;
  const btn = document.createElement('div');
  btn.id = 'wa-bridge-toggle';
  btn.textContent = '💬';
  btn.title = 'פתח ממשק וואטסאפ';
  btn.addEventListener('click', togglePanel);
  document.body.appendChild(btn);
}

function togglePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
    return;
  }
  renderPanel();
}

function renderPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'wa-bridge-panel';

  const headerLabel = currentThreadNumber
    ? `שיחה עם ${currentThreadNumber}`
    : 'לא זוהתה שיחת וואטסאפ בעמוד זה';

  panelEl.innerHTML = `
    <div class="wa-header">
      <span>${headerLabel}</span>
      <span>
        <span style="cursor:pointer;margin-left:10px;" id="wa-logs" title="פתח לוגים בשרת">📋</span>
        <span style="cursor:pointer" id="wa-close">✕</span>
      </span>
    </div>
    <div class="wa-body" id="wa-body">
      ${
        currentThreadNumber
          ? '<div style="color:#888">כתוב הודעה למטה כדי לשלוח בוואטסאפ בפועל.</div>'
          : '<div style="color:#888">פתח מייל ששולח מהגשר (נושא שמתחיל ב-[WA]) כדי לשלוח תגובה.</div>'
      }
    </div>
    <div class="wa-input-row">
      <input type="text" id="wa-input" placeholder="הקלד הודעה..." ${
        currentThreadNumber ? '' : 'disabled'
      } />
      <button id="wa-send" ${currentThreadNumber ? '' : 'disabled'}>שלח</button>
    </div>
  `;

  document.body.appendChild(panelEl);

  document.getElementById('wa-close').addEventListener('click', togglePanel);
  document.getElementById('wa-logs').addEventListener('click', openServerLogs);
  document.getElementById('wa-send').addEventListener('click', sendMessage);
  document.getElementById('wa-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

async function openServerLogs() {
  const { serverUrl } = await getSettings();
  if (!serverUrl) {
    appendToBody('⚠️ יש להגדיר כתובת שרת בהגדרות התוסף כדי לפתוח לוגים.');
    return;
  }
  window.open(serverUrl, '_blank'); // האזור האישי בשרת כולל את סקציית הלוגים
}

async function sendMessage() {
  const input = document.getElementById('wa-input');
  const text = input.value.trim();
  if (!text || !currentThreadNumber) return;

  const { serverUrl, apiKey } = await getSettings();
  if (!serverUrl || !apiKey) {
    appendToBody('⚠️ יש להגדיר כתובת שרת ומפתח API בהגדרות התוסף.');
    return;
  }

  appendToBody(`אני: ${text}`);
  input.value = '';

  try {
    const res = await fetch(`${serverUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ toNumber: currentThreadNumber, text }),
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (err) {
    appendToBody(`⚠️ שגיאה בשליחה: ${err.message}`);
  }
}

function appendToBody(line) {
  const body = document.getElementById('wa-body');
  if (!body) return;
  const div = document.createElement('div');
  div.textContent = line;
  div.style.marginTop = '4px';
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function scanAndUpdate() {
  ensureToggleButton();
  const found = findThreadNumberOnPage();
  if (found !== currentThreadNumber) {
    currentThreadNumber = found;
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
      renderPanel();
    }
  }
}

// Gmail היא אפליקציית SPA - צריך לעקוב אחרי שינויים בדף במקום להסתמך על טעינה חד פעמית
const observer = new MutationObserver(() => scanAndUpdate());
observer.observe(document.body, { childList: true, subtree: true });

scanAndUpdate();
