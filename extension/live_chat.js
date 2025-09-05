// live_chat.js

console.log("live_chat.js loaded.");

const endCallButton = document.getElementById('end-call-btn');
const transcriptContainer = document.getElementById('transcript-container');

// 対話終了ボタンの処理
endCallButton.addEventListener('click', () => {
  console.log("対話終了ボタンがクリックされました。");
  // background.jsに終了を通知
  chrome.runtime.sendMessage({ type: 'terminate_interaction' });
  window.close();
});

// メッセージを画面に追加する関数
function addMessage(sender, text) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  
  if (sender === 'user') {
    messageElement.classList.add('user-message');
    messageElement.textContent = `You: ${text}`;
  } else {
    messageElement.classList.add('ai-message');
    messageElement.textContent = `AI: ${text}`;
  }
  
  transcriptContainer.appendChild(messageElement);
  // 自動で一番下にスクロール
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// background.jsからのメッセージを待つリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'transcript_update') {
    // TODO: ユーザーとAIの発言を区別して表示する
    addMessage(request.sender, request.transcript);
  }
});

// 初期メッセージ
console.log("Live Chat UI is ready.");

// TODO:
// 1. WebSocket/WebRTCでバックエンドと接続する処理
// 2. マイクからの音声を取得し、バックエンドに送信する処理
// 3. バックエンドから受信したAIの音声ストリームを再生する処理
