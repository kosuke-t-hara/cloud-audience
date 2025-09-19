// content.js
if (typeof window.isPrezentoScriptInjected === 'undefined') {
  window.isPrezentoScriptInjected = true;
  console.log("Prezento AI Coachのコンテントスクリプトが注入されました。");

  // --- UI要素の管理 ---
  let timerElement = null;
  let speakingIndicator = null;

  function createUI() {
    // タイマー要素（なければ作成）
    if (!document.getElementById('prezento-ai-coach-timer')) {
      timerElement = document.createElement('div');
      timerElement.id = 'prezento-ai-coach-timer';
      document.body.appendChild(timerElement);
    }
    // 発話インジケーター要素（なければ作成）
    if (!document.getElementById('prezento-speaking-indicator')) {
      speakingIndicator = document.createElement('div');
      speakingIndicator.id = 'prezento-speaking-indicator';
      document.body.appendChild(speakingIndicator);
    }
  }

  function removeUI() {
    const timer = document.getElementById('prezento-ai-coach-timer');
    if (timer) timer.remove();
    timerElement = null;

    const indicator = document.getElementById('prezento-speaking-indicator');
    if (indicator) indicator.remove();
    speakingIndicator = null;
    
    console.log("UI要素を削除しました。");
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
}
