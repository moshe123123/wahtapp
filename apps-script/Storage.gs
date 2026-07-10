// ============================================================
// שמירת היסטוריית שיחות ב-Google Sheet - קבועה לצמיתות,
// לא נמחקת בין הפעלות (בשונה מהזיכרון הזמני ב-Render)
// ============================================================

const SHEET_NAME = 'Messages';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['number', 'direction', 'text', 'time']);
  }
  return sheet;
}

function saveMessage(number, direction, text) {
  const sheet = getSheet();
  sheet.appendRow([number, direction, text, new Date().toISOString()]);
}

function listConversations() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const map = {}; // number -> {lastMessage, lastTime}

  for (let i = 1; i < data.length; i++) {
    const [number, , text, time] = data[i];
    map[number] = { number, lastMessage: text, lastTime: time };
  }
  return Object.values(map);
}

function getConversation(number) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const messages = [];

  for (let i = 1; i < data.length; i++) {
    const [rowNumber, direction, text, time] = data[i];
    if (String(rowNumber) === String(number)) {
      messages.push({ direction, text, time });
    }
  }
  return messages;
}
