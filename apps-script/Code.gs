// ============================================================
// גשר וואטסאפ ↔ מייל - גרסת Google Apps Script
// כל הבקשות (מהתוסף, ומ-Meta) מגיעות לכתובת ה-/exec אחת,
// והניתוב נעשה לפי פרמטרים בבקשה.
// ============================================================

// ---------- הגדרות (Script Properties, לא בקוד עצמו) ----------
// גישה: בעריכת הפרויקט -> גלגל שיניים (Project Settings) -> Script Properties
function getConfig() {
  const p = PropertiesService.getScriptProperties();
  return {
    WHATSAPP_ACCESS_TOKEN: p.getProperty('WHATSAPP_ACCESS_TOKEN'),
    WHATSAPP_PHONE_NUMBER_ID: p.getProperty('WHATSAPP_PHONE_NUMBER_ID'),
    API_KEY: p.getProperty('API_KEY'),
    WEBHOOK_VERIFY_TOKEN: p.getProperty('WEBHOOK_VERIFY_TOKEN'),
    DESTINATION_EMAIL: p.getProperty('DESTINATION_EMAIL'),
  };
}

// ---------- כניסה: כל בקשת GET ----------
function doGet(e) {
  const params = e.parameter;

  // מקרה 1: אימות Webhook ממטא (יש להם תמיד hub.mode בבקשה)
  if (params['hub.mode']) {
    return handleWebhookVerification(params);
  }

  // מקרה 2: קריאות API רגילות מהתוסף/מהדפדפן
  const cfg = getConfig();
  if (params.apiKey !== cfg.API_KEY) {
    return jsonOutput({ error: 'unauthorized' });
  }

  if (params.action === 'health') {
    return jsonOutput({ ok: true });
  }
  if (params.action === 'conversations') {
    return jsonOutput({ conversations: listConversations() });
  }
  if (params.action === 'conversation') {
    return jsonOutput({ messages: getConversation(params.number) });
  }

  return jsonOutput({ error: 'unknown action' });
}

// ---------- כניסה: כל בקשת POST ----------
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ error: 'invalid JSON body' });
  }

  // מקרה 1: זו קריאת Webhook אמיתית ממטא (תמיד יש להם object: whatsapp_business_account)
  if (body.object === 'whatsapp_business_account') {
    return handleIncomingWebhook(body);
  }

  // מקרה 2: קריאה מהתוסף/מהדפדפן - חייבת מפתח API תואם
  const cfg = getConfig();
  if (body.apiKey !== cfg.API_KEY) {
    return jsonOutput({ error: 'unauthorized' });
  }

  if (body.action === 'send') {
    return handleSendMessage(body.toNumber, body.text);
  }

  return jsonOutput({ error: 'unknown action' });
}

// ---------- אימות Webhook (חד פעמי, בהגדרה מול מטא) ----------
function handleWebhookVerification(params) {
  const cfg = getConfig();
  if (params['hub.mode'] === 'subscribe' && params['hub.verify_token'] === cfg.WEBHOOK_VERIFY_TOKEN) {
    return ContentService.createTextOutput(params['hub.challenge']);
  }
  return ContentService.createTextOutput('forbidden');
}

// ---------- קבלת הודעה נכנסת אמיתית ממטא ----------
function handleIncomingWebhook(body) {
  try {
    const entry = body.entry && body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const value = change && change.value;
    const messages = value && value.messages;
    const statuses = value && value.statuses;

    if (messages && messages.length) {
      messages.forEach((msg) => {
        const fromNumber = msg.from;
        const contact = (value.contacts || []).find((c) => c.wa_id === fromNumber);
        const fromName = contact ? contact.profile.name : fromNumber;
        const text = (msg.text && msg.text.body) || '(הודעה ללא טקסט)';

        saveMessage(fromNumber, 'in', text);
        sendEmailNotification(fromNumber, fromName, text);
      });
    }
    // סטטוסים (delivered/read/failed) - כרגע רק מתעלמים, אפשר להרחיב בהמשך
  } catch (err) {
    Logger.log('שגיאה בטיפול ב-webhook: ' + err);
  }
  return jsonOutput({ ok: true });
}

// ---------- שליחת הודעה יוצאת ----------
function handleSendMessage(toNumber, text) {
  const cfg = getConfig();
  const url = 'https://graph.facebook.com/v20.0/' + cfg.WHATSAPP_PHONE_NUMBER_ID + '/messages';

  const payload = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'text',
    text: { body: text },
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.WHATSAPP_ACCESS_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());

  if (response.getResponseCode() === 200) {
    saveMessage(toNumber, 'out', text);
    return jsonOutput({ ok: true, data: result });
  } else {
    return jsonOutput({ ok: false, error: result });
  }
}

// ---------- שליחת מייל התראה (דרך חשבון הג'ימייל של הבעלים, בלי שירות חיצוני) ----------
function sendEmailNotification(fromNumber, fromName, text) {
  const cfg = getConfig();
  const subject = '[WA] ' + fromName;
  const body =
    'מאת: ' + fromName + ' (' + fromNumber + ')\n\n' +
    text + '\n\n---\nwa-thread-id:' + fromNumber;

  GmailApp.sendEmail(cfg.DESTINATION_EMAIL, subject, body);
}

// ---------- עזר: החזרת JSON ----------
function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
