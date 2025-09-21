// content.js
if (typeof window.isPrezentoScriptInjected === 'undefined') {
  window.isPrezentoScriptInjected = true;
  console.log("Prezento AI Coachのコンテントスクリプトが注入されました。");

  // --- UI要素の管理 ---
  let uiContainer = null;

  function createUI() {
    // 親コンテナ（なければ作成）
    if (!document.getElementById('prezento-ui-container')) {
      uiContainer = document.createElement('div');
      uiContainer.id = 'prezento-ui-container';
      document.body.appendChild(uiContainer);
    } else {
      uiContainer = document.getElementById('prezento-ui-container');
    }

    // タイマー要素（なければ作成）
    if (!document.getElementById('prezento-ai-coach-timer')) {
      const timerElement = document.createElement('div');
      timerElement.id = 'prezento-ai-coach-timer';
      uiContainer.appendChild(timerElement);
    }
    // 発話インジケーター要素（なければ作成）
    if (!document.getElementById('prezento-speaking-indicator')) {
      const speakingIndicator = document.createElement('div');
      speakingIndicator.id = 'prezento-speaking-indicator';
      uiContainer.appendChild(speakingIndicator);
    }
    // ★ 一時停止ボタン（なければ作成）
    if (!document.getElementById('prezento-pause-button')) {
      const pauseButton = document.createElement('button');
      pauseButton.id = 'prezento-pause-button';
      pauseButton.textContent = '発話検知を停止';
      uiContainer.appendChild(pauseButton);

      pauseButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE_DETECTION' });
      });
    }
  }

  function removeUI() {
    const container = document.getElementById('prezento-ui-container');
    if (container) container.remove();
    uiContainer = null;
    
    // ★ キーボードショートカットのリスナーも削除
    document.removeEventListener('keydown', handleShortcut);
    console.log("UI要素とショートカットリスナーを削除しました。");
  }


  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const needsAsyncResponse = request.type === 'show-feedback' || request.type === 'show_error';

    switch (request.type) {
      case 'update_timer':
        createUI();
        const timer = document.getElementById('prezento-ai-coach-timer');
        if (timer) timer.textContent = request.time;
        break;

      case 'speaking_status':
        createUI();
        const indicator = document.getElementById('prezento-speaking-indicator');
        if (indicator) {
          if (request.status === 'speaking') {
            indicator.classList.add('speaking');
          } else {
            indicator.classList.remove('speaking');
          }
        }
        break;
      
      // ★ backgroundからの状態変更に応じてボタンのテキストとインジケーターの色を更新
      case 'PAUSE_STATE_CHANGED':
        createUI();
        const button = document.getElementById('prezento-pause-button');
        if (button) {
          button.textContent = request.isPaused ? '発話検知を再開' : '発話検知を停止';
        }
        const paused_indicator = document.getElementById('prezento-speaking-indicator');
        if (paused_indicator) {
          if (request.isPaused) {
            paused_indicator.classList.add('paused');
          } else {
            paused_indicator.classList.remove('paused');
          }
        }
        break;

      case 'trigger_feedback_effect':
        console.log('[content.js] Received trigger_feedback_effect');
        showFlyingFeedbackEffect();
        break;

      case 'show-feedback':
        sendResponse({ status: 'フィードバックを表示しました。' });
        showFeedbackBubble(request.data);
        break;
      
      case 'show_error':
        sendResponse({ status: 'エラーを表示しました。' });
        showFeedbackBubble(request.data, 'error');
        break;

      case 'remove_ui_elements':
        removeUI();
        break;
    }

    return needsAsyncResponse;
  });

  /**
   * 発話インジケーターから右下へ飛ぶエフェクトを表示する
   */
  function showFlyingFeedbackEffect() {
    console.log('[content.js] showFlyingFeedbackEffect called.');
    createUI(); // UI要素が確実に存在するようにする
    const indicator = document.getElementById('prezento-speaking-indicator');
    if (!indicator) {
      console.error('[content.js] Speaking indicator not found! Cannot create effect.');
      return;
    }

    // インジケーターの位置を取得
    const rect = indicator.getBoundingClientRect();
    // エフェクトの中心がインジケーターの中心から始まるように、エフェクトの半径(7.5px)分ずらす
    const startX = rect.left + (rect.width / 2) - 7.5;
    const startY = rect.top + (rect.height / 2) - 7.5;

    const comet = document.createElement('div');
    comet.className = 'prezento-feedback-comet';
    // 初期位置を設定
    comet.style.top = `${startY}px`;
    comet.style.left = `${startX}px`;
    
    document.body.appendChild(comet);

    // 強制リフローをトリガーして、ブラウザに要素の初期状態を確実に描画させる
    void comet.offsetWidth; 

    // 強制リフロー直後にアニメーションクラスを追加する
    comet.classList.add('animate');

    // アニメーション終了後に要素を削除
    setTimeout(() => {
      comet.remove();
    }, 600); // CSSのanimation durationと合わせる
  }

  function showFeedbackBubble(text, style = 'normal') {
    // 既存のフキダシがあれば削除
    const existingBubble = document.querySelector('.prezento-feedback-bubble');
    if (existingBubble) {
      existingBubble.remove();
    }

    // 新しいフキダシを作成
    const bubble = document.createElement('div');
    bubble.className = 'prezento-feedback-bubble';
    if (style === 'error') { // ★ エラー用のクラスを追加
      bubble.classList.add('error');
    }
    bubble.textContent = text;
    document.body.appendChild(bubble);

    // 表示アニメーション
    setTimeout(() => {
      bubble.classList.add('show');
    }, 10);

    // 5秒後に自動で消す
    setTimeout(() => {
      bubble.classList.remove('show');
      // アニメーションが終わってから要素を削除
      setTimeout(() => bubble.remove(), 500);
    }, 5000);
  }

  // ★ ショートカットキーのハンドラ
  function handleShortcut(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'P') {
      event.preventDefault();
      const button = document.getElementById('prezento-pause-button');
      if (button) {
        button.click();
      }
    }
  }

  // ★ ショートカットキーのリスナーを登録
  document.addEventListener('keydown', handleShortcut);
}
