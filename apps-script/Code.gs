// ============================================================
// גשר וואטסאפ ↔ מייל - Google Apps Script (ארכיטקטורת "משיכה מ-Render")
// כל הבקשות (מהתוסף, מהדסקטופ) מגיעות ל-/exec אחד, וה-Script
// עצמו מושך/דוחף נתונים מ-Render באמצעות UrlFetchApp.
// ============================================================

function getConfig() {
  const p = PropertiesService.getScriptProperties();
  return {
    RENDER_URL: p.getProperty('RENDER_URL'),
    API_KEY: p.getProperty('API_KEY'),
  };
}

function fetchConversations() {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/conversations';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'x-api-key': cfg.API_KEY },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('fetchConversations failed: ' + res.getContentText());
    return [];
  }
  const data = JSON.parse(res.getContentText());
  return data.conversations || [];
}

function fetchConversation(number) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/conversations/' + encodeURIComponent(number);
  const res = UrlFetchApp.fetch(url, {
    headers: { 'x-api-key': cfg.API_KEY },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('fetchConversation failed: ' + res.getContentText());
    return [];
  }
  const data = JSON.parse(res.getContentText());
  return data.messages || [];
}

function sendViaRender(toNumber, text) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/send';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.API_KEY },
    payload: JSON.stringify({ toNumber, text }),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(res.getContentText());
  return { ok: res.getResponseCode() === 200, data: result };
}

// מסמן אצל מטא את כל ההודעות הנכנסות ממספר מסוים כ"נקראו" - קוראים לזה
// כשפותחים/מרעננים שיחה, כך שהוי-ים אצל השולח יהפכו לכחולות
function markReadViaRender(number) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/conversations/' + encodeURIComponent(number) + '/mark-read';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.API_KEY },
    payload: JSON.stringify({}),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('markReadViaRender failed: ' + res.getContentText());
    return { ok: false };
  }
  return JSON.parse(res.getContentText());
}

function doGet(e) {
  const params = e.parameter;
  const cfg = getConfig();

  if (params.apiKey !== cfg.API_KEY) {
    return jsonOutput({ error: 'unauthorized' });
  }

  if (params.action === 'health') {
    return jsonOutput({ ok: true });
  }
  if (params.action === 'conversations') {
    return jsonOutput({ conversations: fetchConversations() });
  }
  if (params.action === 'conversation') {
    return jsonOutput({ messages: fetchConversation(params.number) });
  }
  if (params.action === 'send') {
    return jsonOutput(sendViaRender(params.toNumber, params.text));
  }
  if (params.action === 'markRead') {
    return jsonOutput(markReadViaRender(params.number));
  }

  return jsonOutput({ error: 'unknown action' });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
