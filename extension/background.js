// background.js

// WebSocketサーバーのエンドポイントURL
const WEBSOCKET_URL = 'wss://coach-server-819782463010.asia-northeast1.run.app'; 
let websocket = null;

const CLOUD_FUNCTION_URL = 'https://coach-server-819782463010.asia-northeast1.run.app';
const CLOUD_FUNCTION_URL_feedback = CLOUD_FUNCTION_URL + '/feedback';
const CLOUD_FUNCTION_URL_summary = CLOUD_FUNCTION_URL + '/summary';

let helperWindowId = null;
let isRecording = false;
let fullTranscript = ""; // 全文を保存する変数
let targetTabId = null;
let currentMode = 'presenter'; //
let conversationHistory = []; // 会話履歴

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    // 1. ストレージからモードを読み込む
    chrome.storage.local.get(['lastMode'], (result) => {
      // 保存されたモードがなければ 'presenter' をデフォルトにする
      const mode = result.lastMode || 'presenter';   
      isRecording ? stopRecording() : startRecording(mode);
    });
  }
});

function startRecording(mode) {
  if (isRecording) return;
  console.log(`ストリーミングモードで練習を開始: ${mode}`);

  currentMode = mode;
  isRecording = true;
  fullTranscript = ""; // 練習開始時にリセット
  conversationHistory = []; // 会話履歴をリセット

  // 練習開始時に、これから操作するタブのIDを取得して保存する
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      console.error("操作対象のタブが見つかりません。");
      return;
    }
    targetTabId = tabs[0].id; // IDを保存

    // 練習開始時に、一度だけCSSとJSを注入する
    chrome.scripting.insertCSS({
      target: { tabId: targetTabId },
      files: ["content.css"]
    });
    chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ["content.js"]
    });

    // WebSocket接続を確立
    websocket = new WebSocket(WEBSOCKET_URL);

    // 接続が開いたら、練習開始情報をサーバーに送信
    websocket.onopen = () => {
      console.log("WebSocketサーバーに接続しました。");
      websocket.send(JSON.stringify({ type: 'start_session', mode: currentMode }));
      // ヘルパーウィンドウを起動
      chrome.windows.create({
        url: 'mic_helper.html', type: 'popup', width: 250, height: 150,
      }, (win) => {
        helperWindowId = win.id;
      });
    };

    // サーバーからメッセージ（文字起こし結果など）を受信
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'transcript') {
        handleTranscriptFromServer(data);
      }
    };
    websocket.onerror = (error) => {
      console.error("WebSocketエラー:", error);
    };
    websocket.onclose = () => {
      console.log("WebSocketサーバーとの接続が切れました。");
      if (isRecording) {
        stopRecording(); // 意図せず切れた場合も停止処理
      }
    };
  });
}

function stopRecording() {
  if (!isRecording) return;
  console.log("練習を停止します。");

  isRecording = false;
  targetTabId = null; 

  if (websocket) {
    websocket.send(JSON.stringify({ type: 'end_session' }));
    websocket.close();
    websocket = null;
  }
  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }
  // 練習終了時にサマリー生成関数を呼び出す
  generateSummary();
}

// mic_helper.jsからの音声ストリームをWebSocketでサーバーに送信
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'audio_stream' && websocket && websocket.readyState === WebSocket.OPEN) {
    // mic_helper.jsからFloat32Array形式の生データが送られてくる
    // これをサーバーに送る (サーバー側が受け取れる形式にエンコードが必要な場合もある)
    websocket.send(request.data);
  }
});

// ウィンドウが閉じられたことを検知
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    isRecording = false;
    helperWindowId = null;
  }
});

// popup.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.type === 'mic_error') {
    console.error("ヘルパーウィンドウでエラー:", request.error);
    stopRecording();
    return;
  }

  // ポップアップからの開始/停止リクエストを処理
  if (request.action === "start") {
    startRecording(request.mode);
    sendResponse({ message: "練習を開始しました。" });
  } else if (request.action === "stop") {
    stopRecording();
    sendResponse({ message: "練習を停止しました。" });
  }
  
  // 非同期処理を示すためにtrueを返す
  return true;
});

// サーバーからの文字起こし結果を処理する
async function handleTranscriptFromServer(data) {
  fullTranscript += data.transcript + " ";
  
  // 文が確定した場合のみ、Geminiにフィードバックを要求
  if (data.is_final) {
    console.log("確定した文:", data.transcript);
    try {
      const screenshot = await captureVisibleTab();
      // GeminiへのリクエストはHTTPのCloud Functionを呼び出す（またはWebSocket経由で依頼）
      const response = await fetch(CLOUD_FUNCTION_URL , {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'realtime-feedback',
          mode: currentMode,
          transcript: data.transcript, // 確定した文だけを送る
          imageContent: screenshot.split(',')[1],
          history: conversationHistory // 対話モードの場合
        })
      });

      const feedbackData = await response.json();
      if (feedbackData.feedback) {
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'show-feedback', data: feedbackData.feedback });
        }

        // ユーザーの発話とAIの応答を履歴に追加 (使うのは対話モードのときだけ)
        if (currentMode === 'dialogue') {
          conversationHistory.push({ role: 'user', parts: [{ text: data.transcript }] });
          conversationHistory.push({ role: 'model', parts: [{ text: data.feedback }] });
        }
      }
    } catch (error) {
      console.error("フィードバック生成エラー:", error);
    }
  }
}

// 画面キャプチャを取得する関数
function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(dataUrl);
    });
  });
}

// 5. ▼▼▼ サマリー生成用の関数を丸ごと追加 ▼▼▼
async function generateSummary() {
  if (fullTranscript.trim().length === 0) {
    console.log("発話がなかったため、サマリーを生成しませんでした。");
    return;
  }
  console.log("サマリーを生成します。全文:", fullTranscript);

  try {
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'summary-report',
        transcript: fullTranscript,
        mode: currentMode
      })
    });

    try {
      // テキストをJSONとして解析する
      const summaryData = await response.json();

      console.log("サマリー生成結果:", summaryData);
      // 結果を新しいタブで開く
      chrome.tabs.create({ url: 'summary.html' }, (tab) => {
        // 新しいタブにデータを送る
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'show_summary', data: summaryData, mode: currentMode });
        }, 500); // タブの読み込みを待つ
      });
    } catch(error) {
      console.error("JSONの解析に失敗しました。整形後の文字列:", response, "エラー:", error);
    }

  } catch (error) {
    console.error('サマリーの生成に失敗しました:', error);
  }
}
