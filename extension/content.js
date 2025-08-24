// content.js
console.log("Prezento AI Coachのコンテントスクリプトが注入されました。");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('background.jsからメッセージを受信しました:', request);

  if (request.type === 'show-feedback') {
    sendResponse({ status: 'フィードバックを表示しました。' });
    showFeedbackBubble(request.data);
  }

  return true;
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