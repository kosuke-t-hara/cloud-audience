// background.js
const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';

let helperWindowId = null;
let isRecording = false;
let fullTranscript = ""; // 全文を保存する変数
let targetTabId = null;

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    isRecording ? stopRecording() : startRecording();
  }
});

function startRecording() {
  isRecording = true;
  fullTranscript = ""; // 練習開始時にリセット
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

    isRecording = true;
    fullTranscript = "";
    chrome.windows.create({
      url: 'mic_helper.html', type: 'popup', width: 250, height: 150,
    }, (win) => {
      helperWindowId = win.id;
    });
  });
}

function stopRecording() {
  isRecording = false;
  targetTabId = null; 

  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }
  // 練習終了時にサマリー生成関数を呼び出す
  generateSummary();
}

// ウィンドウが閉じられたことを検知
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    isRecording = false;
    helperWindowId = null;
  }
});

// mic_helper.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.type === 'audio_chunk') {
    handleAudioChunk(request.data);
  } else if (request.type === 'mic_error') {
    console.error("ヘルパーウィンドウでエラー:", request.error);
    stopRecording();
  }
});

async function handleAudioChunk(audioContent) {
  try {
    const screenshot = await captureVisibleTab();
    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'realtime-feedback',
        audioContent: audioContent,
        imageContent: screenshot.split(',')[1]
      })
    });
    const data = await response.json();

    console.log("Cloud Functionからの応答データ:", data);

    if (data.feedback) {
      fullTranscript += data.transcript + " ";

      // メッセージを送る直前に、アクティブなタブを取得する
      if (targetTabId) {
        // ステップ3: 注入完了後にメッセージを送信
        chrome.tabs.sendMessage(targetTabId, { type: 'show-feedback', data: data.feedback });

      } else {
        console.error("フィードバック表示先のタブが見つかりません。");
      }
    }
  } catch (error) {
    console.error("handleAudioChunk内でエラーが発生しました:", error.message, error.stack);
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
        transcript: fullTranscript
      })
    });

    try {
      // テキストをJSONとして解析する
      const summaryData = await response.json();
      // 結果を新しいタブで開く
      chrome.tabs.create({ url: 'summary.html' }, (tab) => {
        // 新しいタブにデータを送る
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'show_summary', data: summaryData });
        }, 500); // タブの読み込みを待つ
      });
    } catch(error) {
      console.error("JSONの解析に失敗しました。整形後の文字列:", response, "エラー:", error);
    }

  } catch (error) {
    console.error('サマリーの生成に失敗しました:', error);
  }
}
