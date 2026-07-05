const $serverUrl = document.getElementById('serverUrl');
const $apiKey = document.getElementById('apiKey');
const $status = document.getElementById('status');

chrome.storage.sync.get(['serverUrl', 'apiKey'], (data) => {
  if (data.serverUrl) $serverUrl.value = data.serverUrl;
  if (data.apiKey) $apiKey.value = data.apiKey;
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set(
    { serverUrl: $serverUrl.value.trim(), apiKey: $apiKey.value.trim() },
    () => {
      $status.textContent = 'נשמר!';
      setTimeout(() => ($status.textContent = ''), 1500);
    }
  );
});
