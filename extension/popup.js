// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');

  // 起動時に、保存されたモードを読み込んでUIに反映
  chrome.storage.local.get(['lastMode'], (result) => {
    if (result.lastMode) {
      document.querySelector(`input[name="mode"][value="${result.lastMode}"]`).checked = true;
    }
  });

  startButton.addEventListener('click', () => {
    // 選択されているモードを取得
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;

    // 選択されたモードをストレージに保存
    chrome.storage.local.set({ lastMode: selectedMode }).then(() => {
      console.log(`モード「${selectedMode}」を保存しました。`);
    });

    // background.jsへ、モード情報も一緒に送信する
    chrome.runtime.sendMessage({ action: "start", mode: selectedMode }, (response) => {
      console.log(response?.message);
    });
  });

  stopButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "stop" }, (response) => {
      console.log(response?.message);
    });
  });
});