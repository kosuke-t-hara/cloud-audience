// background.js (WebSocket対応版)
console.log('background.jsが読み込まれました');

// --- 定数 ---
const WEBSOCKET_URL = 'ws://localhost:8080'; // ローカルのバックエンドサーバー

// --- 状態管理 ---
let isRecording = false;
let targetTabId = null;
let socket = null;

// --- Offscreen Document関連 ---
async function hasOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(path)]
  });
  return existingContexts.length > 0;
}

async function setupOffscreenDocument(path) {
  if (await hasOffscreenDocument(path)) return;
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'マイク音声を取得してリアルタイムコーチングを行うため',
  });
}

// --- WebSocket関連 ---
function connectWebSocket() {
  if (socket) return;
  console.log(`WebSocketサーバー (${WEBSOCKET_URL}) に接続します...`);
  socket = new WebSocket(WEBSOCKET_URL);

  socket.onopen = (event) => {
    console.log("WebSocket接続が確立しました。");
    // TODO: 必要に応じて、接続時にペルソナ等の初期情報を送信
  };

  socket.onmessage = (event) => {
    // データが文字列かバイナリかを判定
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        // 文字起こしデータの場合
        if (message.type === 'transcript' && message.data) {
          console.log("WebSocketから文字起こしデータを受信:", message.data);
          // content.jsに文字起こしデータの表示を依頼
          if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, { type: 'show-transcript', text: message.data });
          }
        }
      } catch (e) {
        console.error("受信したJSONメッセージの解析に失敗:", e);
      }
    } else {
      // バイナリデータは音声データとみなし、offscreen.jsに再生を依頼
      console.log("WebSocketからAIの音声データを受信しました。");
      chrome.runtime.sendMessage({
        type: 'play-audio',
        target: 'offscreen',
        data: event.data 
      });
    }
  };

  socket.onclose = (event) => {
    console.log("WebSocket接続が切れました:", event.code, event.reason);
    socket = null;

    // 切断コードが1000 (正常終了) の場合:
    // これは「AIのターンが完了した」ことを意味する正常な切断。
    // 録音(isRecording)は停止せず、マイクは生かしたまま次の発話を待つ。
    if (event.code === 1000) {
      console.log("AIのターンが正常に終了しました。次の発話を待機します。");
      return; // stopRecording() を呼ばない
    }

    // 1000以外のコード (1006異常切断など) で、まだ録音中の場合:
    // これは本当に予期せぬエラーなので、録音を停止する。
    if (isRecording) {
      console.log(`予期せぬエラー(${event.code})で接続が切れたため、録音を停止します。`);
      stopRecording();
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocketエラー:", error);
    // エラー時も停止処理を呼ぶ
    if (isRecording) {
        stopRecording();
    }
  };
}

// --- メインロジック ---
async function startRecording(mode, persona, feedbackMode) {
  if (isRecording) return;
  isRecording = true;

  // WebSocketに接続
  connectWebSocket();

  // UI注入
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) throw new Error("アクティブなタブが見つかりません。");
    targetTabId = tabs[0].id;
    await chrome.scripting.insertCSS({ target: { tabId: targetTabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["content.js"] });
  } catch (e) {
    console.error("UIの注入に失敗しました:", e);
    isRecording = false;
    return;
  }

  // Offscreen Documentをセットアップして録音開始を指示
  await setupOffscreenDocument('offscreen.html');
  chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen' });

  console.log("録音を開始しました。");
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  // WebSocketを切断
  if (socket) {
    socket.close(1000, "Recording stopped by user.");
    socket = null;
  }

  // UI要素の削除
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'remove_ui_elements' });
    targetTabId = null;
  }

  // Offscreen Documentを閉じる
  if (await hasOffscreenDocument('offscreen.html')) {
    chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
    setTimeout(() => chrome.offscreen.closeDocument(), 200);
  }

  console.log("録音を停止しました。");
}

// --- メッセージハンドリング ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // offscreen.jsからのメッセージ
  if (sender.url && sender.url.endsWith('offscreen.html')) {
    switch (request.type) {
      case 'audio_chunk':
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(request.data);

        // 録音中だが、ソケットが存在しない場合:
        // (＝1ターン目が終わり、これは2ターン目の最初のチャンクである)
        } else if (isRecording && !socket) {
          console.log("新しい発話を検知。WebSocketに再接続します...");
          // 再接続を開始する (connectWebSocketは既に socket が null の時だけ new する安全な設計のはず)
          connectWebSocket();
          // 注: 理想的には、connectWebSocketが完了するまでこのチャンクをキューイングすべきですが、
          // サーバー側(index.js)に既に強力なキューイング機能があるため、
          // クライアント側は接続トリガーをかけるだけで良い（この最初のチャンクは失われるかもしれないが、
          // すぐ後のチャンクがサーバーのキューに入り、セッションが開始される）
        }
        return;
      case 'mic_error':
        console.error("Offscreenでマイクエラー:", request.error);
        stopRecording();
        return;
    }
  }

  // popup.jsからのメッセージ
  if (request.action === "start") {
    startRecording(request.mode, request.persona, request.feedbackMode);
    sendResponse({ message: "練習を開始しました。" });
  } else if (request.action === "stop") {
    stopRecording();
    sendResponse({ message: "練習を停止しました。" });
  }
  return true;
});

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    chrome.storage.local.get(['lastMode', 'lastPersona', 'lastFeedbackMode'], (result) => {
      const mode = result.lastMode || 'presenter';
      const persona = result.lastPersona || null;
      const feedbackMode = result.lastFeedbackMode || 'realtime';
      isRecording ? stopRecording() : startRecording(mode, persona, feedbackMode);
    });
  }
});