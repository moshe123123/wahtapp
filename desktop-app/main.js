const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

Menu.setApplicationMenu(null); // מסיר את סרגל התפריטים המיותר (Help/Window/View/Edit/File)

// קובץ ההגדרות נשמר בתיקיית ה-userData הרגילה של Electron
// (זו בדיוק התיקייה C:\Users\<שם>\AppData\Roaming\wathapp-desktop שכבר מצאת)
function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFilePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { scriptUrl: '', apiKey: '', defaultPrefix: '972' };
  }
}

function saveSettings(data) {
  fs.writeFileSync(settingsFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_event, data) => {
  saveSettings(data);
  return true;
});

// גרסה נוכחית - מגיעה מ-package.json (electron-builder מזריק את זה אוטומטית)
ipcMain.handle('app:getVersion', () => app.getVersion());

// בדיקת עדכון ידנית (הכפתור "בדוק עדכון" בממשק) - מחזיר תוצאה לחלון
ipcMain.handle('app:checkForUpdate', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 650,
    title: 'WA Bridge',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // סגירת החלון (X) רק ממזערת לטריי - לא סוגרת את התהליך, כדי שהאפליקציה
  // תמשיך "לקבל" הודעות/עדכונים ברקע. יציאה אמיתית רק דרך תפריט הטריי.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // שולח לממשק הודעה כשנמצא עדכון חדש (כדי להציג הודעה למשתמש שם)
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', info.version);
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', err.message);
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('WA Bridge');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'פתח את WA Bridge',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'בדוק עדכון',
      click: async () => {
        try {
          const result = await autoUpdater.checkForUpdates();
          mainWindow?.webContents.send('update:checked', result?.updateInfo?.version || null);
        } catch (err) {
          mainWindow?.webContents.send('update:error', err.message);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'יציאה',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  // קליק שמאלי רגיל על האייקון גם פותח את החלון (לא רק קליק ימני לתפריט)
  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // בדיקת עדכון אוטומטית ברקע כמה שניות אחרי הפתיחה (לא חוסם את הטעינה)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {}); // שקט אם נכשל (למשל אין אינטרנט רגעית)
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // לא סוגרים את התהליך - האייקון בטריי אמור להישאר זמין גם ב-Windows
  // (בהתנהגות רגילה של Electron, window-all-closed על Windows בדרך כלל
  // כן מסיים את התהליך; משאירים את הבדיקה הזו לבטיחות בלבד)
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
