// background.js (最終版)

let helperWindowId = null;
let isRecording = false;

// APIキーの設定
const SPEECH_API_KEY = 'AIzaSyClUPxhp-V4TdYrjkq0-N6f7B7UenjS5Qw';
const GEMINI_API_KEY = 'AIzaSyBXYC5wZeheBszWRs6-kWn1jbqOqRLZyGY';

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
});

function startRecording() {
  isRecording = true;
  chrome.windows.create({
    url: 'mic_helper.html', type: 'popup', width: 250, height: 150,
  }, (win) => {
    helperWindowId = win.id;
  });
}

function stopRecording() {
  isRecording = false;
  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }
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
    const transcript = await sendToSpeechAPI(audioContent);
    if (transcript) {
      const screenshotDataUrl = await captureVisibleTab();
      const base64ImageData = screenshotDataUrl.split(',')[1];
      await sendToGeminiAPI(transcript, base64ImageData);
    }
  } catch (error) {
    console.error("handleAudioChunk内でエラーが発生しました:", error);
  }
}

// --- 以下、以前作成したAPI連携とヘルパー関数 ---

async function sendToSpeechAPI(audioContent) {
  const API_URL = `https://speech.googleapis.com/v1/speech:recognize?key=${SPEECH_API_KEY}`;
  const requestBody = {
    config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'ja-JP' },
    audio: { content: audioContent },
  };
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const data = await response.json();
    if (data.results && data.results.length > 0) return data.results[0].alternatives[0].transcript;
  } catch (error) { console.error('Speech API Error:', error); }
  return null;
}

function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(dataUrl);
    });
  });
}

async function sendToGeminiAPI(text, image) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  const requestBody = {
    contents: [{ parts: [
      { text: `あなたは親身なプレゼンの聴衆です。このスライド画像と、発表者の「${text}」という発言内容を踏まえ、80文字以内で短いコメントか、ポジティブなリアクションを一つだけ生成してください。` },
      { inline_data: { mime_type: 'image/jpeg', data: image } }
    ]}]
  };
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    
    const data = await response.json();

    // ▼▼▼ ここからが重要な修正 ▼▼▼
    // data.candidatesが存在し、かつ配列が空でないことを確認する
    if (data.candidates && data.candidates.length > 0) {
      const feedback = data.candidates[0].content.parts[0].text;

      // ▼▼▼ ここから変更 ▼▼▼
      console.log(`これからcontent.jsへフィードバック「${feedback}」を送信します。`);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'show-feedback', data: feedback }, (response) => {
            // メッセージが届いたかどうかの確認
            if (chrome.runtime.lastError) {
              console.error('メッセージ送信エラー:', chrome.runtime.lastError.message);
            } else {
              console.log('content.jsからの応答:', response?.status);
            }
        });
        } else {
          console.error("メッセージ送信先のタブが見つかりません。");
        }
      });
      // ▲▲▲ ここまで変更 ▲▲▲
    } else {
      // 応答が生成されなかった場合のログ
      console.warn('Geminiは応答を生成しませんでした。レスポンス:', data);
    }
    // ▲▲▲ ここまで修正 ▲▲▲

  } catch (error) { console.error('Gemini API Error:', error); }
}