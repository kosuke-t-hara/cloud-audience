// content.js (再注入エラー防止版)

// このスクリプトが既に注入されているかをグローバルなフラグで管理
if (typeof window.prezentoScriptInjected === 'undefined') {
  window.prezentoScriptInjected = true;

  let transcriptContainer = null;

  // background.jsからのメッセージを処理するリスナー
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case 'show-transcript':
        updateTranscript(request.text, 'user');
        break;
      case 'show-feedback':
        updateTranscript(request.data, 'ai');
        break;
      case 'remove_ui_elements':
        removeUI();
        break;
    }
    return true;
  });

  /**
   * 画面上に文字起こしUIを作成または更新する
   * @param {string} text 表示するテキスト
   * @param {'user' | 'ai'} speaker 話者 (CSSクラスの割り当てに使用)
   */
  function updateTranscript(text, speaker) {
    if (!transcriptContainer) {
      transcriptContainer = document.createElement('div');
      transcriptContainer.id = 'prezento-ai-transcript-container';
      document.body.appendChild(transcriptContainer);
    }

    const messageEl = document.createElement('p');
    messageEl.className = `prezento-ai-message ${speaker}`;
    messageEl.textContent = text;

    transcriptContainer.appendChild(messageEl);
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }

  /**
   * ページから文字起こしUIを削除し、注入フラグをリセットする
   */
  function removeUI() {
    if (transcriptContainer) {
      transcriptContainer.remove();
      transcriptContainer = null;
    }
    // UI削除時にフラグをリセットすることで、再度スクリプトの注入が可能になる
    window.prezentoScriptInjected = false;
  }

}