const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 650,
    title: 'WA Bridge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
