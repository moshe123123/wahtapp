# מדריך התחלה - גשר וואטסאפ ↔ מייל

## מה יש בתיקייה הזו?
```
whatsapp-email-bridge/
├── server-cloud-api/   ← זה מה שאתה צריך (מבוסס WhatsApp Cloud API הרשמי)
├── extension/          ← תוסף הכרום ל-Gmail
├── server/             ← גרסה ישנה/חלופית (Baileys) - לא בשימוש, אפשר להתעלם
├── .gitignore
└── README.md
```
**המסלול שבחרנו יחד**: `server-cloud-api` + `extension`. תתעלם מתיקיית `server/`
(היא נשארה כתיעוד לגרסה חלופית שדחינו כי דרשה סריקת QR מהאפליקציה).

---

## שלב 1: העלאה לגיטהאב

פתח טרמינל בתוך תיקיית `whatsapp-email-bridge` (התיקייה הראשית, לא תת-תיקייה):

```bash
git init
git branch -M main
git remote add origin https://github.com/moshe123123/wahtapp.git
git add .
git status          # ← ודא שאין כאן שום קובץ .env! רק .env.example אמור להופיע
git commit -m "גשר וואטסאפ-מייל: שרת Cloud API + תוסף כרום"
git push -u origin main
```

אם תקבל שגיאת "refusing to merge unrelated histories" (קורה אם בריפו כבר יש README):
```bash
git push -u origin main --allow-unrelated-histories
```

אם תתבקש להתחבר: הכי פשוט להתקין [GitHub CLI](https://cli.github.com) ולהריץ
`gh auth login` פעם אחת, ואז ה-push יעבוד בלי סיסמאות.

**חשוב**: `.gitignore` כבר מוגדר כך שקובץ `.env` (עם הסודות האמיתיים) לעולם לא יעלה
לגיטהאב. תמלא סודות אמיתיים רק ב-Render (שלב הבא), לא בקוד עצמו.

---

## שלב 2: פריסת השרת ל-Render

1. גש ל-https://render.com והתחבר (אפשר עם חשבון GitHub - יעזור לך גם לחבר ריפואים).
2. **New +** → **Web Service**.
3. חבר את הריפו `moshe123123/wahtapp`.
4. הגדרות בסיסיות:
   - **Root Directory**: `server-cloud-api`  ← קריטי! אחרת Render ינסה להריץ מהשורש
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (אפשר לשדרג אח"כ אם תרצה שהשרת לא "יירדם")
5. גלול ל-**Environment Variables** והוסף את כל המשתנים מ-`server-cloud-api/.env.example`,
   עם הערכים **האמיתיים** שלך (מ-Meta for Developers, מ-Gmail וכו'):
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `WEBHOOK_VERIFY_TOKEN` (תבחר מחרוזת סודית משלך)
   - `API_KEY` (תבחר מחרוזת סודית משלך - זה מה שהתוסף ישתמש בו)
   - `DESTINATION_EMAIL`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
6. לחץ **Create Web Service**. Render יבנה ויריץ - תוך דקה-שתיים תקבל כתובת כמו
   `https://wahtapp.onrender.com`.
7. גש ל-`https://wahtapp.onrender.com` בדפדפן - אמור להופיע האזור האישי שבנינו.

### אם עדיין לא עשית את שלב ה-Meta for Developers
עצור כאן וחזור ל-`server-cloud-api/README.md` (שלב 0) - שם ההוראות המלאות
איך ליצור אפליקציה במטא ולקבל את כל הערכים הדרושים לשלב 5 למעלה.

---

## שלב 3: רישום המספר דרך האזור האישי
1. באזור האישי (`https://wahtapp.onrender.com`), הזן את ה-`API_KEY` שהגדרת ב-Render.
2. לחץ "שלח לי קוד" (SMS או שיחה).
3. הזן את הקוד שהתקבל ולחץ "אמת קוד".
4. בדוק בסקציית הלוגים שרואים "המספר אומת בהצלחה".

## שלב 4: חיבור ה-Webhook מול מטא
ב-Meta for Developers → מוצר WhatsApp → Configuration → Webhook:
- Callback URL: `https://wahtapp.onrender.com/webhook`
- Verify Token: אותו ערך מ-`WEBHOOK_VERIFY_TOKEN`
- הרשם לשדה `messages`

## שלב 5: התקנת תוסף הכרום
1. `chrome://extensions` → הפעל "מצב מפתח" → "טען לא ארוז" → בחר את תיקיית `extension`.
2. לחץ על אייקון התוסף, הזן: `https://wahtapp.onrender.com` ואת אותו `API_KEY`.

## שלב 6: בדיקה מקצה לקצה
1. שלח הודעת וואטסאפ מטלפון אחר (אחד מ-5 הנמענים המאושרים בדשבורד של מטא) למספר שלך.
2. בדוק שהיא הגיעה כמייל ל-Gmail שלך.
3. פתח את המייל ב-Gmail, לחץ על כפתור ה-💬 הצף, שלח תגובה - ובדוק שהיא מגיעה בפועל
   לוואטסאפ.
4. אם משהו לא עובד - פתח את סקציית הלוגים באזור האישי (או לחץ 📋 בפאנל של התוסף) ותראה בדיוק איפה זה נתקע.

---

## סדר עדיפויות אם אתה תקוע
1. `/health` בכתובת השרת - האם השרת בכלל רץ?
2. סקציית הלוגים - מה כתוב שם באדום?
3. Render → Logs (בדשבורד של Render עצמו) - שגיאות שרת שלא נתפסו בכלל.
4. Meta for Developers → מוצר WhatsApp → API Setup - לבדוק שהטוקן לא פג תוקף.
