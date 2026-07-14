// ============================================================
// ממשק ה-Gmail Add-on - קורא/שולח דרך Render (UrlFetchApp, שרת-לשרת)
// ============================================================

function onHomepage(e) {
  return buildContactListCard();
}

function buildContactListCard() {
  const builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle('💬 גשר וואטסאפ'));

  const section = CardService.newCardSection();

  const conversations = fetchConversations();
  conversations.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

  if (!conversations.length) {
    section.addWidget(CardService.newTextParagraph().setText('אין שיחות עדיין.'));
  } else {
    conversations.forEach((c) => {
      const preview = (c.lastMessage || '').toString().slice(0, 30);
      const btn = CardService.newTextButton()
        .setText(c.number + '  |  ' + preview)
        .setOnClickAction(
          CardService.newAction().setFunctionName('openConversation').setParameters({ number: String(c.number) })
        );
      section.addWidget(btn);
    });
  }

  builder.addSection(section);

  const newSection = CardService.newCardSection().setHeader('שיחה חדשה');
  newSection.addWidget(CardService.newTextInput().setFieldName('newNumber').setTitle('מספר (972...)'));
  newSection.addWidget(
    CardService.newTextButton()
      .setText('▶ התחל')
      .setOnClickAction(CardService.newAction().setFunctionName('startNewConversationFromCard'))
  );
  builder.addSection(newSection);

  const refreshSection = CardService.newCardSection();
  refreshSection.addWidget(
    CardService.newTextButton()
      .setText('🔄 רענן רשימה')
      .setOnClickAction(CardService.newAction().setFunctionName('refreshHomepage'))
  );
  builder.addSection(refreshSection);

  return builder.build();
}

function refreshHomepage(e) {
  const card = buildContactListCard();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

function openConversation(e) {
  const number = e.parameters.number;
  const card = buildConversationCard(number);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}

function buildConversationCard(number) {
  const builder = CardService.newCardBuilder();
  builder.setHeader(CardService.newCardHeader().setTitle('שיחה עם ' + number));

  const section = CardService.newCardSection();
  const messages = fetchConversation(number);

  if (!messages.length) {
    section.addWidget(CardService.newTextParagraph().setText('אין הודעות עדיין בשיחה זו.'));
  } else {
    messages.forEach((m) => {
      const prefix = m.direction === 'out' ? '➡️ אני' : '⬅️ הוא/היא';
      const time = formatTimeShort(m.time);
      section.addWidget(
        CardService.newTextParagraph().setText('<b>' + prefix + '</b> (' + time + ')<br>' + escapeForCard(m.text))
      );
    });
  }

  section.addWidget(CardService.newTextInput().setFieldName('replyText').setTitle('הודעה'));
  section.addWidget(
    CardService.newTextButton()
      .setText('📤 שלח')
      .setOnClickAction(CardService.newAction().setFunctionName('sendReplyFromCard').setParameters({ number: number }))
  );
  section.addWidget(
    CardService.newTextButton()
      .setText('🔄 רענן שיחה')
      .setOnClickAction(CardService.newAction().setFunctionName('openConversationRefresh').setParameters({ number: number }))
  );

  builder.addSection(section);
  return builder.build();
}

function openConversationRefresh(e) {
  const number = e.parameters.number;
  const card = buildConversationCard(number);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

function sendReplyFromCard(e) {
  const number = e.parameters.number;
  const text = e.formInput.replyText;

  let notif = 'לא הוזן טקסט';
  if (text) {
    const result = sendViaRender(number, text);
    notif = result.ok ? 'נשלח!' : 'שגיאה בשליחה';
  }

  const card = buildConversationCard(number);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .setNotification(CardService.newNotification().setText(notif))
    .build();
}

function startNewConversationFromCard(e) {
  const raw = e.formInput.newNumber || '';
  const number = normalizeNumber(raw);
  if (!number) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('נא להזין מספר תקין'))
      .build();
  }
  const card = buildConversationCard(number);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}

// ממיר מספר מקומי (שמתחיל ב-0) לפורמט בינלאומי - קידומת ברירת מחדל: 972 (ישראל)
function normalizeNumber(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const prefix = '972';
  if (digits.startsWith('0')) return prefix + digits.slice(1);
  return digits;
}

function formatTimeShort(iso) {
  try {
    const d = new Date(iso);
    return Utilities.formatDate(d, 'Asia/Jerusalem', 'HH:mm');
  } catch (err) {
    return '';
  }
}

function escapeForCard(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
