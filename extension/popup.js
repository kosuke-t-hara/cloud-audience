// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const presenterPersonaInput = document.getElementById('presenter-persona-input');
  const personaText = document.getElementById('persona-text');

  // ▼▼▼ ラジオボタン変更時の表示制御を追加 ▼▼▼
  function togglePersonaInput() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    if (selectedMode === 'presenter') {
      presenterPersonaInput.style.display = 'block';
    } else {
      presenterPersonaInput.style.display = 'none';
    }
  }

  modeRadios.forEach(radio => {
    radio.addEventListener('change', togglePersonaInput);
  });

  // 起動時に、保存された言語設定を読み込んでUIに反映
  chrome.storage.local.get(['lastLanguage'], (result) => {
    if (result.lastLanguage) {
      document.querySelector(`input[name="language"][value="${result.lastLanguage}"]`).checked = true;
    }
  });

  // 起動時に、保存されたモードを読み込んでUIに反映
  chrome.storage.local.get(['lastMode'], (result) => {
    if (result.lastMode) {
      document.querySelector(`input[name="mode"][value="${result.lastMode}"]`).checked = true;
    }
  });

  // 起動時に、保存されたペルソナを読み込んでUIに反映
  chrome.storage.local.get(['lastPersona'], (result) => {
    if (result.lastPersona) {
      personaText.value = result.lastPersona;
    }
  });

  // 起動時に、保存されたフィードバックモードを読み込んでUIに反映
  chrome.storage.local.get(['lastFeedbackMode'], (result) => {
    if (result.lastFeedbackMode) {
      document.querySelector(`input[name="feedback_mode"][value="${result.lastFeedbackMode}"]`).checked = true;
    }
  });

  startButton.addEventListener('click', () => {
    // ▼▼▼ 選択された言語を取得 ▼▼▼
    const selectedLanguage = document.querySelector('input[name="language"]:checked').value;
    // 選択されているモードを取得
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    // プレゼンターモードの場合、ペルソナ設定を取得
    const persona = (selectedMode === 'presenter') ? personaText.value : null;
    // 選択されているフィードバックモードを取得
    const feedbackMode = document.querySelector('input[name="feedback_mode"]:checked').value;

    // 選択されたモードをストレージに保存
    chrome.storage.local.set({ lastLanguage: selectedLanguage }).then(() => {
      console.log(`言語設定「${selectedLanguage}」を保存しました。`);
    });

    // 選択されたモードをストレージに保存
    chrome.storage.local.set({ lastMode: selectedMode }).then(() => {
      console.log(`モード「${selectedMode}」を保存しました。`);
    });

    // 入力されたペルソナをストレージに保存
    chrome.storage.local.set({ lastPersona: persona }).then(() => {
      console.log(`ペルソナ「${persona}」を保存しました。`);
    });

    // 選択されたフィードバックモードをストレージに保存
    chrome.storage.local.set({ lastFeedbackMode: feedbackMode }).then(() => {
      console.log(`フィードバックモード「${feedbackMode}」を保存しました。`);
    });

    // background.jsへ、モード情報も一緒に送信する
    chrome.runtime.sendMessage({
      action: "start",
      mode: selectedMode,
      persona: persona,
      feedbackMode: feedbackMode,
      language: selectedLanguage
    }, (response) => {
      console.log(response?.message);
    });
  });

  stopButton.addEventListener('click', () => {
    // ボタンを無効化し、テキストを変更
    stopButton.disabled = true;
    stopButton.textContent = '生成中...';

    chrome.runtime.sendMessage({ action: "stop" }, (response) => {
      console.log(response?.message);
      // backgroundからの応答があればポップアップを閉じる
      if (response) {
        window.close();
      }
    });
  });
  // 初期表示の更新
  togglePersonaInput();
});