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

// שליחת הודעת תבנית מאושרת - ליזום שיחה חדשה עם מספר שלא כתב ב-24 השעות האחרונות
function sendTemplateViaRender(toNumber, templateName) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/send-template';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.API_KEY },
    payload: JSON.stringify({ toNumber, templateName, languageCode: 'he' }),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(res.getContentText());
  return { ok: res.getResponseCode() === 200, data: result };
}

// בקשת פתיחת שיחה דרך SMS (חינמי, לא נוגע ב-WhatsApp API) - שולח SMS
// שמבקש מהנמען לכתוב הודעת וואטסאפ ראשונה, זה פותח את חלון 24 השעות בחינם
function requestOpenViaRender(toNumber, senderName) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/request-open';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.API_KEY },
    payload: JSON.stringify({ toNumber, senderName }),
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

// הורדת תוכן מדיה (base64) עבור הודעה נכנסת - פרוקסי שקוף ל-Render
function fetchMediaViaRender(mediaId) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/media/' + encodeURIComponent(mediaId);
  const res = UrlFetchApp.fetch(url, {
    headers: { 'x-api-key': cfg.API_KEY },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('fetchMediaViaRender failed: ' + res.getContentText());
    return { ok: false };
  }
  return JSON.parse(res.getContentText());
}

// שליחת קובץ מדיה (תמונה/וידאו/מסמך/קול) יוצא - הגוף גדול מדי בשביל GET,
// ולכן זה עובר דרך doPost עם payload בגוף הבקשה (לא ב-URL)
function sendMediaViaRender(payload) {
  const cfg = getConfig();
  const url = cfg.RENDER_URL + '/send-media';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(res.getContentText());
  return { ok: res.getResponseCode() === 200, data: result };
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
  if (params.action === 'sendTemplate') {
    return jsonOutput(sendTemplateViaRender(params.toNumber, params.templateName));
  }
  if (params.action === 'requestOpen') {
    return jsonOutput(requestOpenViaRender(params.toNumber, params.senderName));
  }
  if (params.action === 'markRead') {
    return jsonOutput(markReadViaRender(params.number));
  }
  if (params.action === 'media') {
    return jsonOutput(fetchMediaViaRender(params.mediaId));
  }

  return jsonOutput({ error: 'unknown action' });
}

// בקשות POST - כרגע רק שליחת מדיה (הגוף גדול מדי בשביל query params ב-GET).
// הגוף חייב לכלול apiKey (כי אין query params כאן), וגם action.
function doPost(e) {
  const cfg = getConfig();
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ error: 'invalid JSON body' });
  }

  if (body.apiKey !== cfg.API_KEY) {
    return jsonOutput({ error: 'unauthorized' });
  }

  if (body.action === 'sendMedia') {
    return jsonOutput(sendMediaViaRender({
      toNumber: body.toNumber,
      base64: body.base64,
      mimeType: body.mimeType,
      filename: body.filename,
      caption: body.caption,
    }));
  }

  return jsonOutput({ error: 'unknown action' });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
