// content.js (リファクタリング版)

let transcriptContainer = null;

// background.jsからのメッセージを処理するリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    // ユーザーの文字起こしテキストを表示
    case 'show-transcript':
      updateTranscript(request.text, 'user');
      break;
    // AIのフィードバックテキストを表示 (既存機能との互換性のため残す)
    case 'show-feedback':
      updateTranscript(request.data, 'ai');
      break;
    // 録音停止時にUIを削除
    case 'remove_ui_elements':
      removeUI();
      break;
  }
  return true; // 非同期応答の可能性があることを示す
});

/**
 * 画面上に文字起こしUIを作成または更新する
 * @param {string} text 表示するテキスト
 * @param {'user' | 'ai'} speaker 話者 (CSSクラスの割り当てに使用)
 */
function updateTranscript(text, speaker) {
  // UIコンテナがまだなければ作成してページに追加
  if (!transcriptContainer) {
    transcriptContainer = document.createElement('div');
    transcriptContainer.id = 'prezento-ai-transcript-container';
    document.body.appendChild(transcriptContainer);
  }

  // 新しいメッセージ要素を作成
  const messageEl = document.createElement('p');
  messageEl.className = `prezento-ai-message ${speaker}`;
  messageEl.textContent = text;

  // コンテナに追加し、常に最新のメッセージが見えるように自動スクロール
  transcriptContainer.appendChild(messageEl);
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

/**
 * ページから文字起こしUIを削除する
 */
function removeUI() {
  if (transcriptContainer) {
    transcriptContainer.remove();
    transcriptContainer = null;
  }
}
