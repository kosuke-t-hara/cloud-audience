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
let isDetectionPaused = false; // ★ 発話検知の一時停止状態


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
    // ★★★ 変更: ミッションモード中は、ヘルパーウィンドウが閉じても録音を止めない ★★★
    if (currentMode === 'mission') {
      console.log("ミッションモード中にヘルパーウィンドウが閉じられましたが、セッションは継続します。");
      helperWindowId = null; // IDだけリセット
      return;
    }
    
    if (isRecording) {
        stopRecording();
    }
    isRecording = false;
    helperWindowId = null;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 非同期応答が必要なメッセージタイプを判定
  const needsAsyncResponse = 
    request.type === 'GET_AUTH_STATE' || 
    request.type === 'SIGN_IN_WITH_TOKEN' ||
    request.action === 'start' || 
    request.action === 'stop' ||
    request.action === 'requestScoring';

  // 非同期処理を即時実行関数でラップ
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
      // ★ 発話検知の一時停止/再開をトグル
      case 'TOGGLE_PAUSE_DETECTION':
        isDetectionPaused = !isDetectionPaused;
        // content.jsに状態を通知してボタンテキストを更新
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'PAUSE_STATE_CHANGED', isPaused: isDetectionPaused });
        }
        // mic_helper.jsに状態を通知してVADを制御
        if (helperWindowId) {
          chrome.runtime.sendMessage({ type: 'SET_PAUSE_STATE', paused: isDetectionPaused });
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
        try {
          const credential = firebase.auth.GoogleAuthProvider.credential(request.idToken);
          const userCredential = await firebase.auth().signInWithCredential(credential);
          const user = userCredential.user;
          currentUser = user; // グローバル変数も更新
          sendResponse({ 
            success: true, 
            user: { 
              displayName: user.displayName, 
              email: user.email 
            } 
          });
        } catch (error) {
          console.error("Firebaseへのログインに失敗しました (background):", error);
          sendResponse({ success: false, error: error.message });
        }
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
      case "startMission": // from popup.js
        // ミッションのパラメータをグローバル変数に保存するだけにする
        currentMode = 'mission';
        currentPersona = request.persona;
        currentSettings = request.settings; // settings全体を保存
        targetTabId = request.tabId; // popup.jsから渡されたタブIDを保存
        
        console.log(`ミッション準備完了: ${targetTabId}`);
        sendResponse({ success: true, message: "ミッションの準備ができました。" });
        break;
      
      case "startMissionAudio": // from mission.js
        // mission.jsからのトリガーで録音を開始する
        if (currentMode === 'mission' && targetTabId) {
          startRecording(
            currentMode,
            currentPersona,
            currentSettings.lastFeedbackMode,
            currentSettings.lastFaceAnalysis,
            targetTabId // 保存しておいたタブIDを渡す
          );
          sendResponse({ success: true, message: "ミッションの音声を記録開始しました。" });
        } else {
          console.error("ミッションの音声記録を開始できませんでした。モードまたはタブIDが無効です。");
          sendResponse({ success: false, error: "ミッションが正しくセットアップされていません。" });
        }
        break;

      case "requestScoring": // from popup.js
        // スコアリングリクエストをCloud Functionに転送する
        try {
          const idToken = await getAuthToken();
          if (!idToken) {
            sendResponse({ success: false, error: "ログインしていません。" });
            return;
          }
          const response = await fetch(CLOUD_FUNCTION_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
              type: 'mission-scoring',
              objective: request.objective,
              conversationLog: request.conversationLog // ★ transcriptをconversationLogに変更
            })
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答" }));
            throw new Error(errorData.error || `APIエラー: ${response.status}`);
          }
          const results = await response.json();
          sendResponse({ success: true, results: results });
        } catch (error) {
          console.error("Scoring request failed:", error);
          sendResponse({ success: false, error: error.message });
        }
        break;
      case "stop":
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'remove_ui_elements' }).catch(e => console.log("UI削除メッセージの送信に失敗しました:", e.message));
        }
        stopRecording(); // コールバックを渡さない
        sendResponse({}); // すぐに応答を返す
        break;
    }
  })();
  
  return needsAsyncResponse;
});

// --- メインロジック ---
function startRecording(mode, persona, feedbackMode, faceAnalysis, tabId = null) {
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
  isDetectionPaused = false;

  timerInterval = setInterval(() => {
    elapsedTimeInSeconds++;
    const minutes = Math.floor(elapsedTimeInSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedTimeInSeconds % 60).toString().padStart(2, '0');
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'update_timer', time: `${minutes}:${seconds}` });
    }
  }, 1000);

  // 1分ごとにアラームを設定
  chrome.alarms.create('oneMinuteTimer', {
    delayInMinutes: 1,
    periodInMinutes: 1
  });

  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

  const setupRecordingTab = (id) => {
    targetTabId = id;

    if (currentMode !== 'mission') {
      chrome.scripting.insertCSS({ target: { tabId: targetTabId }, files: ["content.css"] });
      chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["content.js"] });
    }

    const helperUrl = `mic_helper.html?faceAnalysis=${isFaceAnalysisEnabled ? 'on' : 'off'}`;
    chrome.windows.create({
      url: helperUrl,
      type: 'popup',
      width: 250,
      height: 150,
      focused: false
    }, (win) => {
      helperWindowId = win.id;
    });
  };

  if (tabId) {
    setupRecordingTab(tabId);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        console.error("操作対象のタブが見つかりません。");
        return;
      }
      setupRecordingTab(tabs[0].id);
    });
  }
}

function stopRecording() { // sendResponseCallback を削除
  console.log('[background.js] stopRecording called.');
  isRecording = false;

  chrome.action.setBadgeText({ text: '' });
  chrome.action.setBadgeBackgroundColor({ color: '#FFFFFF' });
  
  clearInterval(timerInterval);
  timerInterval = null;
  
  // アラームをクリア
  chrome.alarms.clear('oneMinuteTimer');
  
  targetTabId = null;

  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' }).catch(e => console.log(e));
    helperWindowId = null;
  }

  if (currentMode !== 'mission') {
    // stopRecordingは非同期でなくなったので、sendResponseCallbackを渡さない
    generateSummary(sessionAnalysisResults, conversationSummary, elapsedTimeInSeconds, sessionFeedbackHistory);
  }
}

async function handleAudioChunk(audioContent) {
  // ★ 一時停止中は処理をスキップ
  if (isDetectionPaused) {
    return;
  }
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

    let imageContent = null;
    if (currentMode !== 'mission') {
      const screenshot = await captureVisibleTab();
      imageContent = screenshot ? screenshot.split(',')[1] : null;
    }

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

    // エフェクト表示のトリガーをcontent.jsに送信
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: 'trigger_feedback_effect' });
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

      // ★★★ ここから修正 ★★★
      if (currentMode === 'mission') {
        // ミッションモードの場合：mission.jsに対話ログとステータスを送信
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, { type: 'MISSION_TRANSCRIPT_UPDATE', speaker: 'user', text: data.transcript });
          chrome.tabs.sendMessage(targetTabId, { type: 'MISSION_TRANSCRIPT_UPDATE', speaker: 'ai', text: data.feedback });
          chrome.tabs.sendMessage(targetTabId, { type: 'STATUS_UPDATE', status: 'あなたの応答を待っています...' });
        }
      } else {
        // フリープレイモードの場合：既存の処理
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
      // ★★★ ここまで修正 ★★★
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

// --- Mission Mode Functions ---

async function startMission(missionId, sendResponse) {
  // 既存のタイマーやセッションがあればクリア
  clearInterval(timerInterval);
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'remove_ui_elements' }).catch(e => console.log(e));
  }

  const db = firebase.firestore();
  try {
    const missionDoc = await db.collection('missions').doc(missionId).get();
    if (missionDoc.exists) {
      const missionData = missionDoc.data();
      
      // ミッションページを開き、そのタブIDを保存
      const missionUrl = chrome.runtime.getURL(`mission.html?mission_id=${missionId}`);
      chrome.tabs.create({ url: missionUrl }, (tab) => {
        targetTabId = tab.id; // ★ targetTabId を設定

        // popup.htmlで設定された最新の設定値を取得
        chrome.storage.local.get(['lastFeedbackMode', 'lastFaceAnalysis'], (settings) => {
          // 取得したペルソナと設定で練習を開始
          startRecording(
            'mission', // mode
            missionData.persona, // persona
            settings.lastFeedbackMode,
            settings.lastFaceAnalysis
          );
          sendResponse({ success: true, message: "ミッションを開始しました。" });
        });
      });

    } else {
      console.error("Mission not found in Firestore:", missionId);
      sendResponse({ success: false, error: "指定されたミッションが見つかりません。" });
    }
  } catch (error) {
    console.error("Error starting mission:", error);
    sendResponse({ success: false, error: "ミッションの開始に失敗しました。" });
  }
}

async function requestScoring(missionId, transcript, sendResponse) {
  const idToken = await getAuthToken();
  if (!idToken) {
    sendResponse({ success: false, error: "ログインしていません。" });
    return;
  }

  try {
    const db = firebase.firestore();
    const missionDoc = await db.collection('missions').doc(missionId).get();
    if (!missionDoc.exists) {
      sendResponse({ success: false, error: "ミッションデータが見つかりません。" });
      return;
    }
    const missionData = missionDoc.data();
    const objective = missionData.objective;

    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: 'mission-scoring',
        objective: objective,
        transcript: transcript
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "サーバーから不明なエラー応答" }));
      throw new Error(errorData.error || `APIエラー: ${response.status}`);
    }

    const results = await response.json();
    sendResponse({ success: true, results: results });

  } catch (error) {
    console.error("Scoring request failed:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// --- 1分経過通知機能 ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'oneMinuteTimer') {
    // 経過時間を取得 (elapsedTimeInSeconds はグローバル変数として存在)
    const minutes = Math.floor(elapsedTimeInSeconds / 60);
    
    // 0分の場合は通知しない（開始直後の誤爆防止）
    if (minutes === 0) {
      return;
    }

    // 通知を作成
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'Prezento AI Coach',
      message: `${minutes}分が経過しました。`,
      priority: 2
    });
  }
});
