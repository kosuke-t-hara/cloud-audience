// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const presenterPersonaInput = document.getElementById('presenter-persona-input');
  const personaText = document.getElementById('persona-text');
  // ★★★ 追加: スライダー関連の要素を取得 ★★★
  const thresholdSlider = document.getElementById('silence-threshold-slider');
  const thresholdValueSpan = document.getElementById('silence-threshold-value');
  const pauseDurationSlider = document.getElementById('pause-duration-slider');
  const pauseDurationValueSpan = document.getElementById('pause-duration-value');

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

  // 起動時に、保存された表情分析設定を読み込んでUIに反映
  chrome.storage.local.get(['lastFaceAnalysis'], (result) => {
    if (result.lastFaceAnalysis) {
      document.querySelector(`input[name="face_analysis"][value="${result.lastFaceAnalysis}"]`).checked = true;
    }
  });

  // ★★★ 追加: スライダーの値を読み込んでUIに反映 ★★★
  chrome.storage.local.get({ silenceThreshold: 0.02 }, (result) => {
    const value = parseFloat(result.silenceThreshold);
    thresholdSlider.value = value;
    thresholdValueSpan.textContent = value.toFixed(3);
  });

  // ★★★ 追加: スライダー操作時のイベントリスナー ★★★
  thresholdSlider.addEventListener('input', () => {
    const value = parseFloat(thresholdSlider.value);
    thresholdValueSpan.textContent = value.toFixed(3);
    chrome.storage.local.set({ silenceThreshold: value });
  });

  // ★★★ 追加: 無音検知時間スライダーの値を読み込んでUIに反映 ★★★
  chrome.storage.local.get({ pauseDuration: 5 }, (result) => {
    const value = parseInt(result.pauseDuration, 10);
    pauseDurationSlider.value = value;
    pauseDurationValueSpan.textContent = value;
  });

  // ★★★ 追加: 無音検知時間スライダー操作時のイベントリスナー ★★★
  pauseDurationSlider.addEventListener('input', () => {
    const value = parseInt(pauseDurationSlider.value, 10);
    pauseDurationValueSpan.textContent = value;
    chrome.storage.local.set({ pauseDuration: value });
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
    // 選択されている表情分析設定を取得
    const faceAnalysis = document.querySelector('input[name="face_analysis"]:checked').value;

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

    // 選択された表情分析設定をストレージに保存
    chrome.storage.local.set({ lastFaceAnalysis: faceAnalysis }).then(() => {
      console.log(`表情分析設定「${faceAnalysis}」を保存しました。`);
    });

    // background.jsへ、モード情報も一緒に送信する
    chrome.runtime.sendMessage({
      action: "start",
      mode: selectedMode,
      persona: persona,
      feedbackMode: feedbackMode,
      language: selectedLanguage,
      faceAnalysis: faceAnalysis
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