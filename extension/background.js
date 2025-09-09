// background.js
const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';
console.log('background.jsが読み込まれました');

let helperWindowId = null;
let isRecording = false;

let fullTranscript = ""; // 全文を保存する変数
let targetTabId = null;

let currentMode = 'presenter'; //
let currentPersona = null;
let conversationHistory = []; // 会話履歴

let latestVideoFrame = null; // 最新のカメラ映像を保存する変数
let isFaceAnalysisEnabled = true; // 表情分析が有効かどうかのフラグ

let sessionAnalysisResults = []; // 分析結果を蓄積する配列
let currentFeedbackMode = 'realtime'; // フィードバックモード

// 表示タイマー用
let timerInterval = null;
let elapsedTimeInSeconds = 0;

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    // 1. ストレージからモードを読み込む
    chrome.storage.local.get(['lastMode', 'lastPersona', 'lastFeedbackMode', 'lastFaceAnalysis'], (result) => {
      const mode = result.lastMode || 'presenter';
      const persona = result.lastPersona || null;
      const feedbackMode = result.lastFeedbackMode || 'realtime';
      const faceAnalysis = result.lastFaceAnalysis || 'on';
      isRecording ? stopRecording() : startRecording(mode, persona, feedbackMode, faceAnalysis);
    });
  }
});

function startRecording(mode, persona, feedbackMode, faceAnalysis) {
  clearInterval(timerInterval); // 既存のタイマーをクリア

  currentMode = mode;
  currentPersona = persona; // ペルソナを保存
  currentFeedbackMode = feedbackMode; // フィードバックモードを保存
  isFaceAnalysisEnabled = (faceAnalysis === 'on'); // 表情分析の有効/無効を設定
  isRecording = true;
  fullTranscript = ""; // 練習開始時にリセット
  conversationHistory = []; // 会話履歴をリセット
  sessionAnalysisResults = []; // 分析結果をリセット
  elapsedTimeInSeconds = 0; // タイマーリセット

  // 1秒ごとにタイマー表示を更新
  timerInterval = setInterval(() => {
    elapsedTimeInSeconds++;
    const minutes = Math.floor(elapsedTimeInSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedTimeInSeconds % 60).toString().padStart(2, '0');
    const timeString = `${minutes}:${seconds}`;
    
    // content.jsに経過時間を送信
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'update_timer', time: timeString });
    }
  }, 1000);

  // 練習開始時にバッジをRECに変更
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

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
      console.log("マイクヘルパーウィンドウが作成されました:", helperWindowId);
    });
  });
}

function stopRecording(sendResponseCallback) {
  isRecording = false;
  stopRequestSendResponse = sendResponseCallback;

  // ローディング表示を開始
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#FFA500' }); // オレンジ色
  
  clearInterval(timerInterval); // タイマーを停止
  timerInterval = null;
  // content.jsにUI要素の削除を依頼
  if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'remove_ui_elements' });
  }

  targetTabId = null; // 操作対象のタブIDをリセット

  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }

  // 練習終了時にサマリー生成関数を呼び出す
  generateSummary(sessionAnalysisResults);
}

// ウィンドウが閉じられたことを検知
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    isRecording = false;
    helperWindowId = null;
  }
});

let stopRequestSendResponse = null; // sendResponseを保持する変数

// mic_helper.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'video_frame') {
    console.log("カメラフレームを受信しました。");
    latestVideoFrame = request.data;
    // このメッセージは非同期応答が不要なため、ここで処理を終える
    return; 
  }

  if (request.type === 'audio_chunk') {
    handleAudioChunk(request.data);
    return;
  } 
  
  if (request.type === 'mic_error') {
    console.error("ヘルパーウィンドウでエラー:", request.error);
    console.error(request.error);
    stopRecording();
    return;
  }

  // ポップアップからの開始/停止リクエストを処理
  if (request.action === "start") {
    console.log("練習を開始します。");
    startRecording(request.mode, request.persona, request.feedbackMode, request.faceAnalysis);
    sendResponse({ message: "練習を開始しました。" });
  } else if (request.action === "stop") {
    stopRecording(sendResponse); // sendResponseを渡す
    return true; // 非同期のsendResponseを使うためにtrueを返す
  } else if (request.type === 'SUMMARY_DISPLAY_COMPLETE') {
    // サマリー表示完了の通知を受けたらバッジを消す
    chrome.action.setBadgeText({ text: '' });
  }
  
  return false; // その他のメッセージタイプでは非同期応答は不要
});

async function handleAudioChunk(audioContent) {
  console.log("音声チャンクを処理中...");

  try {
    const screenshot = await captureVisibleTab();
    
    const requestBody = {
      type: 'realtime-feedback',
      mode: currentMode,
      persona: currentPersona,
      audioContent: audioContent,
      imageContent: screenshot.split(',')[1],
      history: conversationHistory
    };

    if (isFaceAnalysisEnabled) {
      requestBody.videoFrameContent = latestVideoFrame;
    }

    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json();

    console.log("Cloud Functionからの応答データ:", data);

    // ▼▼▼ 返ってきた分析結果を配列に保存 ▼▼▼
    if (data.analysisData) {
      sessionAnalysisResults.push(data.analysisData);
    }

    if (data.feedback) {
      // ユーザーの発話とAIの応答を履歴に追加
      conversationHistory.push({ role: 'user', parts: [{ text: data.transcript }] });
      conversationHistory.push({ role: 'model', parts: [{ text: data.feedback }] });

      fullTranscript += data.transcript + " ";

      // ▼▼▼ フィードバックモードに応じて処理を分岐 ▼▼▼
      switch (currentFeedbackMode) {
        case 'realtime':
          // リアルタイムフィードバックの場合の処理
          // メッセージを送る直前に、アクティブなタブを取得する
          if (targetTabId) {
            // ステップ3: 注入完了後にメッセージを送信
            chrome.tabs.sendMessage(targetTabId, { type: 'show-feedback', data: data.feedback });
          } else {
            console.error("フィードバック表示先のタブが見つかりません。");
          }
          break;
        case 'badge':
          // バッジ表示の場合の処理
          chrome.action.setBadgeText({ text: '💡' }); // 例として電球アイコン
          chrome.action.setBadgeBackgroundColor({ color: '#FBC02D' }); // 黄色など
          // TODO: ポップアップにフィードバック履歴を保存するロジックを追加
          break;
        case 'summary':
          // 何もしない
          break;
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

async function generateSummary(analysisResults) {
  // ★変更点: 先にサマリータブを開く
  const summaryTab = await chrome.tabs.create({ url: 'summary.html' });

    if (analysisResults.length === 0) {
      console.log("分析データがなかったため、サマリーを生成しませんでした。");
    // ★変更点: エラーメッセージをサマリータブに表示
    setTimeout(() => {
        chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary_error', error: '分析データがありませんでした。' });
    }, 500);
    return;
  }
      console.log("サマリーを生成します。分析結果:", analysisResults);

  try {
      const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'summary-report',
          analysisResults: analysisResults,
          mode: currentMode,
          persona: currentPersona,
        })
      });

    // ★変更点: response.ok でステータスコードをチェック
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答", details: response.statusText }));
        console.error("サマリー生成APIエラー:", errorData);
        chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary_error', error: errorData.error, details: errorData.details });
        return; // ここで処理を終了
    }

        const summaryData = await response.json();

        console.log("サマリー生成結果:", summaryData);
    // ★変更点: setTimeoutの時間を調整し、tab.id を summaryTab.id に変更
    setTimeout(() => {
      chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary', data: summaryData, mode: currentMode });
    }, 100);

  } catch (error) {
    console.error('サマリーの生成に失敗しました:', error);
    // ★変更点: エラーをサマリータブに表示
    chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary_error', error: 'サマリーの生成に失敗しました。', details: error.message });
  } finally {
    // ★変更点: popup.jsに応答を返す
    if (stopRequestSendResponse) {
      stopRequestSendResponse({ message: "処理が完了しました。" });
      stopRequestSendResponse = null; // 使い終わったらクリア
    }
  }
}
