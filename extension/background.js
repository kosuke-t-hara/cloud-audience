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

// ★★★ 追加: 保留中のサマリージョブを保存するオブジェクト ★★★
const pendingSummaries = {};

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

// ★★★ 修正: stopRequestSendResponse の管理方法を変更 ★★★
function stopRecording(sendResponseCallback) {
  isRecording = false;
  // stopRequestSendResponse = sendResponseCallback; // ← この行を削除

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

  // ★★★ 修正: generateSummary に sendResponseCallback を渡す ★★★
  generateSummary(sessionAnalysisResults, conversationSummary, elapsedTimeInSeconds, sessionFeedbackHistory, sendResponseCallback);
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
  if (!isRecording) {
    console.log("録音停止後にhandleAudioChunkが呼ばれましたが、処理を中断しました。");
    return;
  }

  try {
    const screenshot = await captureVisibleTab();
    const imageContent = screenshot ? screenshot.split(',')[1] : null;

    const requestBody = {
      type: 'realtime-feedback',
      mode: currentMode,
      persona: currentPersona,
      audioContent: audioContent,
      imageContent: imageContent,
      history: conversationHistory,
      conversationSummary: conversationSummary
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

    const MAX_CONSECUTIVE_FAILURES = 5;
    if (!data.transcript || data.transcript.trim() === "") {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
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
      consecutiveFailures = 0;
    }

    if (data.newConversationSummary) {
      conversationSummary = data.newConversationSummary;
    }

    if (data.analysisData) {
      sessionAnalysisResults.push(data.analysisData);
    }

    if (data.feedback) {
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
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.warn("スクリーンショットの撮影に失敗しました:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(dataUrl);
    });
  });
}

// ★★★ 修正: generateSummary のロジックを全面的に変更 ★★★
async function generateSummary(analysisResults, finalConversationSummary, totalTime, feedbackHistory, sendResponseCallback) {
  // 先にタブを開き、ユーザーに待機状態を示す
  const summaryTab = await chrome.tabs.create({ url: 'summary.html', active: false });

  // pendingSummaries にジョブ情報を保存
  pendingSummaries[summaryTab.id] = {
    analysisResults,
    finalConversationSummary,
    totalTime,
    feedbackHistory,
    mode: currentMode,
    persona: currentPersona,
    sendResponseCallback // popup.jsへのコールバックを保存
  };
  
  // タブをアクティブにする
  chrome.tabs.update(summaryTab.id, { active: true });
}

// ★★★ 追加: タブの更新を監視するリスナー ★★★
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // タブの読み込みが完了し、かつ保留中のサマリージョブがある場合
  if (changeInfo.status === 'complete' && pendingSummaries[tabId]) {
    const job = pendingSummaries[tabId];
    // 複数回発火しないように、すぐにジョブを削除
    delete pendingSummaries[tabId];

    try {
      // 分析データがない場合はエラーを表示
      if (job.analysisResults.length === 0) {
        console.log("分析データがなかったため、サマリーを生成しませんでした。");
        chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: '十分な分析データがありませんでした。' });
        return;
      }

      console.log("サマリー生成を開始します。分析結果:", job.analysisResults);

      // Cloud Function を呼び出してサマリーを生成
      const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'summary-report',
          analysisResults: job.analysisResults,
          mode: job.mode,
          persona: job.persona,
          conversationSummary: job.finalConversationSummary,
          totalTime: job.totalTime
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答", details: response.statusText }));
        console.error("サマリー生成APIエラー:", errorData);
        chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: errorData.error, details: errorData.details });
        return;
      }

      const summaryData = await response.json();
      console.log("サマリー生成結果:", summaryData);
      
      // summary.js に最終的なデータを送信
      chrome.tabs.sendMessage(tabId, {
        type: 'show_summary',
        data: { ...summaryData, feedbackHistory: job.feedbackHistory },
        mode: job.mode
      });

    } catch (error) {
      console.error('サマリーの生成に失敗しました:', error);
      chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: 'サマリーの生成に失敗しました。', details: error.message });
    } finally {
      // 最後に popup.js に応答を返す
      if (job.sendResponseCallback) {
        job.sendResponseCallback({ message: "処理が完了しました。" });
      }
    }
  }
});
""
