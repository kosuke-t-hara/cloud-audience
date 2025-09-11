// background.js
const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';
console.log('background.jsが読み込まれました');

let helperWindowId = null;
let isRecording = false;

let fullTranscript = ""; // 全文を保存する変数
let targetTabId = null;

let currentMode = 'presenter';
let currentPersona = null;
let conversationHistory = []; // 会話履歴
let conversationSummary = ""; // ★ 新しく追加：会話の要約を保持する変数

let latestVideoFrame = null; // 最新のカメラ映像を保存する変数
let isFaceAnalysisEnabled = true; // 表情分析が有効かどうかのフラグ

let sessionAnalysisResults = []; // 分析結果を蓄積する配列
let sessionFeedbackHistory = []; // ★ 追加: フィードバック履歴を蓄積する配列
let currentFeedbackMode = 'realtime'; // フィードバックモード
let consecutiveFailures = 0; // ★ 音声認識の連続失敗回数をカウント

// 表示タイマー用
let timerInterval = null;
let elapsedTimeInSeconds = 0;

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
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
  clearInterval(timerInterval);

  currentMode = mode;
  currentPersona = persona;
  currentFeedbackMode = feedbackMode;
  isFaceAnalysisEnabled = (faceAnalysis === 'on');
  isRecording = true;
  fullTranscript = "";
  conversationHistory = [];
  conversationSummary = ""; // ★ 練習開始時に要約をリセット
  sessionAnalysisResults = [];
  sessionFeedbackHistory = []; // ★ 追加: 練習開始時にフィードバック履歴をリセット
  elapsedTimeInSeconds = 0;
  consecutiveFailures = 0; // ★ カウンターをリセット

  timerInterval = setInterval(() => {
    elapsedTimeInSeconds++;
    const minutes = Math.floor(elapsedTimeInSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedTimeInSeconds % 60).toString().padStart(2, '0');
    const timeString = `${minutes}:${seconds}`;
    
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'update_timer', time: timeString });
    }
  }, 1000);

  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      console.error("操作対象のタブが見つかりません。");
      return;
    }
    targetTabId = tabs[0].id;

    chrome.scripting.insertCSS({
      target: { tabId: targetTabId },
      files: ["content.css"]
    });
    chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ["content.js"]
    });

    const helperUrl = `mic_helper.html?faceAnalysis=${isFaceAnalysisEnabled ? 'on' : 'off'}`;
    chrome.windows.create({
      url: helperUrl, type: 'popup', width: 250, height: 150,
    }, (win) => {
      helperWindowId = win.id;
      console.log("マイクヘルパーウィンドウが作成されました:", helperWindowId);
    });
  });
}

function stopRecording(sendResponseCallback) {
  isRecording = false;
  stopRequestSendResponse = sendResponseCallback;

  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
  
  clearInterval(timerInterval);
  timerInterval = null;
  if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'remove_ui_elements' });
  }

  targetTabId = null;

  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }

  // ★ generateSummary に conversationSummary, elapsedTimeInSeconds, sessionFeedbackHistory を渡す
  generateSummary(sessionAnalysisResults, conversationSummary, elapsedTimeInSeconds, sessionFeedbackHistory);
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    isRecording = false;
    helperWindowId = null;
  }
});

let stopRequestSendResponse = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'video_frame') {
    latestVideoFrame = request.data;
    return; 
  }

  if (request.type === 'audio_chunk') {
    handleAudioChunk(request.data);
    return;
  } 
  
  if (request.type === 'mic_error') {
    console.error("ヘルパーウィンドウでエラー:", request.error);
    stopRecording();
    return;
  }

  if (request.action === "start") {
    startRecording(request.mode, request.persona, request.feedbackMode, request.faceAnalysis);
    sendResponse({ message: "練習を開始しました。" });
  } else if (request.action === "stop") {
    stopRecording(sendResponse);
    return true;
  } else if (request.type === 'SUMMARY_DISPLAY_COMPLETE') {
    chrome.action.setBadgeText({ text: '' });
  }
  
  return false;
});

async function handleAudioChunk(audioContent) {
  // ★★★ 修正点: 録音が停止されていたら、後続の処理をすべて中断する ★★★
  if (!isRecording) {
    console.log("録音停止後にhandleAudioChunkが呼ばれましたが、処理を中断しました。");
    return;
  }

  try {
    const screenshot = await captureVisibleTab();
    
    // ★★★ 修正点: screenshotがnullの場合を考慮 ★★★
    const imageContent = screenshot ? screenshot.split(',')[1] : null;

    const requestBody = {
      type: 'realtime-feedback',
      mode: currentMode,
      persona: currentPersona,
      audioContent: audioContent,
      imageContent: imageContent, // nullまたはBase64データ
      history: conversationHistory,
      conversationSummary: conversationSummary // ★ 現在の要約を送信
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

    // ★ 音声認識の失敗を監視
    const MAX_CONSECUTIVE_FAILURES = 5;
    if (!data.transcript || data.transcript.trim() === "") {
      consecutiveFailures++;
      console.log(`音声認識失敗が連続 ${consecutiveFailures} 回目です。`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log("音声認識の連続失敗が上限に達したため、録音を停止します。");
        stopRecording();
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, {
            type: 'show_error',
            data: '音声が認識できませんでした。マイクの設定を確認し、再度お試しください。'
          });
        }
        return;
      }
    } else {
      consecutiveFailures = 0; // 成功したらリセット
    }

    // ★ 新しい要約を受け取り、更新する
    if (data.newConversationSummary) {
      conversationSummary = data.newConversationSummary;
      console.log("会話の要約を更新しました:", conversationSummary);
    }

    if (data.analysisData) {
      sessionAnalysisResults.push(data.analysisData);
    }

    if (data.feedback) {
      // ★ 追加: フィードバック履歴を保存 (発言と応答のペア)
      sessionFeedbackHistory.push({
        transcript: data.transcript,
        feedback: data.feedback
      });

      conversationHistory.push({ role: 'user', parts: [{ text: data.transcript }] });
      conversationHistory.push({ role: 'model', parts: [{ text: data.feedback }] });
      fullTranscript += data.transcript + " ";

      switch (currentFeedbackMode) {
        case 'realtime':
          if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, { type: 'show-feedback', data: data.feedback });
          } else {
            console.error("フィードバック表示先のタブが見つかりません。");
          }
          break;
        case 'badge':
          chrome.action.setBadgeText({ text: '💡' });
          chrome.action.setBadgeBackgroundColor({ color: '#FBC02D' });
          break;
        case 'summary':
          break;
      }
    }
  } catch (error) {
    console.error("handleAudioChunk内でエラーが発生しました:", error.message, error.stack);
  }
}

function captureVisibleTab() {
  return new Promise((resolve) => { // ★ reject を削除
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
      // ★ エラーが発生した場合は、コンソールに警告を出し、null を返す
      if (chrome.runtime.lastError) {
        console.warn("スクリーンショットの撮影に失敗しました:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(dataUrl);
    });
  });
}

// ★ generateSummary が feedbackHistory を受け取るように変更
async function generateSummary(analysisResults, finalConversationSummary, totalTime, feedbackHistory) {
  const summaryTab = await chrome.tabs.create({ url: 'summary.html' });

  if (analysisResults.length === 0) {
    console.log("分析データがなかったため、サマリーを生成しませんでした。");
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
        conversationSummary: finalConversationSummary, // ★ 最終的な要約を送信
        totalTime: totalTime // ★ 経過時間を追加
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答", details: response.statusText }));
      console.error("サマリー生成APIエラー:", errorData);
      chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary_error', error: errorData.error, details: errorData.details });
      return;
    }

    const summaryData = await response.json();
    console.log("サマリー生成結果:", summaryData);
    setTimeout(() => {
      // ★ summary.jsに渡すデータに feedbackHistory を追加
      chrome.tabs.sendMessage(summaryTab.id, { 
        type: 'show_summary', 
        data: { ...summaryData, feedbackHistory: feedbackHistory }, 
        mode: currentMode 
      });
    }, 500);

  } catch (error) {
    console.error('サマリーの生成に失敗しました:', error);
    chrome.tabs.sendMessage(summaryTab.id, { type: 'show_summary_error', error: 'サマリーの生成に失敗しました。', details: error.message });
  } finally {
    if (stopRequestSendResponse) {
      stopRequestSendResponse({ message: "処理が完了しました。" });
      stopRequestSendResponse = null;
    }
  }
}
