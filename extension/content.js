// content.js
console.log("Prezento AI Coachのコンテントスクリプトが注入されました。");

// タイマー要素の作成
let timerElement = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('background.jsからメッセージを受信しました:', request);

  // 経過時間の表示/更新
  if (request.type === 'update_timer') {
    if (!timerElement) {
      // ページにタイマー要素がなければ作成する
      timerElement = document.createElement('div');
      timerElement.id = 'prezento-ai-coach-timer';
      document.body.appendChild(timerElement);
    }
    timerElement.textContent = request.time;
  }

  if (request.type === 'show-feedback') {
    sendResponse({ status: 'フィードバックを表示しました。' });
    showFeedbackBubble(request.data);
  }

  // 練習終了時にタイマーを削除
  if (request.type === 'remove_ui_elements') {
    if (timerElement) {
      timerElement.remove();
      timerElement = null;
      console.log("タイマー要素を削除しました。");
    }
    // TODO: リアルタイムフィードバックの要素もここで削除する
  }

  return;
});

function showFeedbackBubble(text) {
  // 既存のフキダシがあれば削除
  const existingBubble = document.querySelector('.prezento-feedback-bubble');
  if (existingBubble) {
    existingBubble.remove();
  }

  // 新しいフキダシを作成
  const bubble = document.createElement('div');
  bubble.className = 'prezento-feedback-bubble';
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