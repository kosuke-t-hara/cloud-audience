// background.js

// --- Firebase SDKの読み込みと初期化 ---
try {
  importScripts(
    './lib/firebase-app.js',
    './lib/firebase-auth.js',
    'firebase-config.js'
  );
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  console.error('Firebase SDKの読み込みに失敗しました。', e);
}

const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';
console.log('background.jsが読み込まれました');

// --- グローバル変数 ---
let currentUser = null;
let helperWindowId = null;
let isRecording = false;
let targetTabId = null;
let currentMode = 'presenter';
let currentPersona = null;
let conversationHistory = [];
let conversationSummary = "";
let latestVideoFrame = null;
let isFaceAnalysisEnabled = true;
let sessionAnalysisResults = [];
let sessionFeedbackHistory = [];
let consecutiveFailures = 0;
let timerInterval = null;
let elapsedTimeInSeconds = 0;
const pendingSummaries = {};


// --- 認証状態の監視とブロードキャスト ---
firebase.auth().onAuthStateChanged(user => {
  currentUser = user;
  chrome.runtime.sendMessage({
    type: 'AUTH_STATE_CHANGED',
    user: user ? { displayName: user.displayName, email: user.email } : null
  });
});


// --- 認証ヘルパー関数 ---
async function getAuthToken() {
  if (currentUser) {
    try {
      return await currentUser.getIdToken(true);
    } catch (error) {
      console.error('IDトークンの取得に失敗しました:', error);
      return null;
    }
  }
  return null;
}

// --- イベントリスナー ---
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    chrome.storage.local.get(['lastMode', 'lastPersona', 'lastFeedbackMode', 'lastFaceAnalysis'], (result) => {
      const { lastMode, lastPersona, lastFeedbackMode, lastFaceAnalysis } = result;
      isRecording ? stopRecording() : startRecording(lastMode, lastPersona, lastFeedbackMode, lastFaceAnalysis);
    });
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    if (isRecording) {
        stopRecording();
    }
    isRecording = false;
    helperWindowId = null;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.type) {
      case 'video_frame':
        latestVideoFrame = request.data;
        break;
      case 'audio_chunk':
        await handleAudioChunk(request.data);
        break;
      case 'mic_error':
        console.error("ヘルパーウィンドウでエラー:", request.error);
        stopRecording();
        break;
      case 'speaking_status':
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'speaking_status', status: request.status });
        }
        break;
      case 'SUMMARY_DISPLAY_COMPLETE':
        chrome.action.setBadgeText({ text: '' });
        break;
      case 'GET_AUTH_STATE':
        const user = await new Promise(resolve => {
          const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            unsubscribe();
            resolve(user);
          });
        });
        currentUser = user;
        if (user) {
          sendResponse({ 
            loggedIn: true, 
            user: { 
              displayName: user.displayName, 
              email: user.email 
            } 
          });
        } else {
          sendResponse({ loggedIn: false });
        }
        break;
      case 'SIGN_IN_WITH_TOKEN':
        const credential = firebase.auth.GoogleAuthProvider.credential(request.idToken);
        firebase.auth().signInWithCredential(credential)
          .catch((error) => {
            console.error("Firebaseへのログインに失敗しました (background):", error);
          });
        break;
      case 'SUMMARY_PAGE_READY':
        const tabId = sender.tab.id;
        const job = pendingSummaries[tabId];
        if (!job) {
          console.warn(`SUMMARY_PAGE_READY を受け取りましたが、tabId: ${tabId} の保留中ジョブが見つかりません。`);
          return;
        }
        delete pendingSummaries[tabId];

        try {
          if (job.analysisResults.length === 0) {
            chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: '十分な分析データがありませんでした。' });
            return;
          }

          const idToken = await getAuthToken();
          if (!idToken) {
            chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: 'ログインしていません。サマリーを生成できませんでした。' });
            return;
          }

          const response = await fetch(CLOUD_FUNCTION_URL, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
              type: 'summary-report',
              analysisResults: job.analysisResults,
              mode: job.mode,
              persona: job.persona,
              conversationSummary: job.finalConversationSummary,
              totalTime: job.totalTime,
              feedbackHistory: job.feedbackHistory
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答", details: response.statusText }));
            chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: errorData.error, details: errorData.details });
            return;
          }

          const summaryData = await response.json();
          
          chrome.tabs.sendMessage(tabId, {
            type: 'show_summary',
            data: { ...summaryData, feedbackHistory: job.feedbackHistory },
            mode: job.mode
          });

        } catch (error) {
          console.error('サマリーの生成に失敗しました:', error);
          chrome.tabs.sendMessage(tabId, { type: 'show_summary_error', error: 'サマリーの生成に失敗しました。', details: error.message });
        } finally {
          if (job.sendResponseCallback) {
            job.sendResponseCallback({ message: "処理が完了しました。" });
          }
        }
        break;
    }

    switch (request.action) {
      case "start":
        startRecording(request.lastMode, request.lastPersona, request.lastFeedbackMode, request.lastFaceAnalysis);
        sendResponse({ message: "練習を開始しました。" });
        break;
      case "stop":
        stopRecording(sendResponse);
        break;
    }
  })();
  
  return true; // 非同期処理のため
});

// (他の関数は変更なし)
// --- メインロジック ---
function startRecording(mode, persona, feedbackMode, faceAnalysis) {
  clearInterval(timerInterval);

  currentMode = mode || 'presenter';
  currentPersona = persona || null;
  currentFeedbackMode = feedbackMode || 'realtime';
  isFaceAnalysisEnabled = (faceAnalysis === 'on');
  isRecording = true;
  conversationHistory = [];
  conversationSummary = "";
  sessionAnalysisResults = [];
  sessionFeedbackHistory = [];
  elapsedTimeInSeconds = 0;
  consecutiveFailures = 0;

  timerInterval = setInterval(() => {
    elapsedTimeInSeconds++;
    const minutes = Math.floor(elapsedTimeInSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedTimeInSeconds % 60).toString().padStart(2, '0');
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'update_timer', time: `${minutes}:${seconds}` });
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

    chrome.scripting.insertCSS({ target: { tabId: targetTabId }, files: ["content.css"] });
    chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["content.js"] });

    const helperUrl = `mic_helper.html?faceAnalysis=${isFaceAnalysisEnabled ? 'on' : 'off'}`;
    chrome.windows.create({ url: helperUrl, type: 'popup', width: 250, height: 150 }, (win) => {
      helperWindowId = win.id;
    });
  });
}

function stopRecording(sendResponseCallback) {
  console.log('[background.js] stopRecording called.'); // ログ1
  isRecording = false;

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

  generateSummary(sessionAnalysisResults, conversationSummary, elapsedTimeInSeconds, sessionFeedbackHistory, sendResponseCallback);
}

async function handleAudioChunk(audioContent) {
  if (!isRecording) {
    return;
  }

  try {
    const idToken = await getAuthToken();
    if (!idToken) {
      console.error('認証トークンが見つかりません。録音を停止します。');
      stopRecording();
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, { type: 'show_error', data: 'ログインセッションが切れました。再度ログインしてください。' });
      }
      return;
    }

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
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`APIエラー: ${response.status}`);
    }

    const data = await response.json();

    const MAX_CONSECUTIVE_FAILURES = 5;
    if (!data.transcript || data.transcript.trim() === "") {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stopRecording();
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'show_error', data: '音声が認識できませんでした。マイクの設定を確認してください。' });
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
    console.error("handleAudioChunk内でエラーが発生しました:", error);
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

async function generateSummary(analysisResults, finalConversationSummary, totalTime, feedbackHistory, sendResponseCallback) {
  console.log('[background.js] generateSummary called.'); // ログ2
  const summaryTab = await chrome.tabs.create({ url: 'summary.html', active: false });

  pendingSummaries[summaryTab.id] = {
    analysisResults,
    finalConversationSummary,
    totalTime,
    feedbackHistory,
    mode: currentMode,
    persona: currentPersona,
    sendResponseCallback
  };
  
  chrome.tabs.update(summaryTab.id, { active: true });
}