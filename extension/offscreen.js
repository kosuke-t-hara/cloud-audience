import { GoogleGenAI, Modality } from './lib/gemini-sdk.js';

// --- 定数 ---
const GEMINI_API_KEY = 'AIzaSyBXYC5wZeheBszWRs6-kWn1jbqOqRLZyGY'; 
const MODEL_NAME = 'gemini-2.5-flash-preview-native-audio-dialog';

// --- Gemini関連の変数 ---
let genAI;
let session;

// --- 音声処理関連の変数 ---
let inputAudioContext;
let outputAudioContext;
let mediaStream;
let scriptProcessorNode;
let sourceNode;
let nextStartTime = 0;
const sources = new Set();
let isRecording = false; // 録音状態を管理するフラグ

// --- 初期化処理 ---
function initialize() {
  console.log('Offscreen: 初期化処理を開始');
  try {
    genAI = new GoogleGenAI({ 
      apiKey: GEMINI_API_KEY,
      httpOptions: { apiVersion: 'v1alpha' } 
    });
    inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    console.log('Offscreen: オーディオコンテキストとGeminiクライアントの準備完了');
  } catch (e) {
    console.error('Offscreen: 初期化中にエラーが発生', e);
  }
}

// --- メインの接続・セッション開始処理 ---
async function startSession() {
  if (session) {
    console.log('Offscreen: 既存のセッションがあるため、一度閉じてから再接続します。');
    session.close();
    session = null;
  }
  console.log('Offscreen: Geminiとの新しいセッションを開始します...');
  try {
    session = await genAI.live.connect({
      model: MODEL_NAME,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
      },
      callbacks: {
        onopen: () => {
          console.log('Offscreen: Geminiとの接続が確立しました (onopen)');
        },
        onmessage: async (message) => {
          handleGeminiMessage(message);
        },
        onerror: (error) => {
          console.error('Offscreen: Geminiセッションでエラーが発生', error);
        },
        onclose: (event) => {
          console.log('Offscreen: Geminiセッションが終了しました', event);
          // サーバー側から切断された場合、録音状態を停止する
          if (isRecording) {
            stopRecording();
          }
        },
      },
    });
    console.log('Offscreen: `live.connect` が完了しました。');
    return true;
  } catch (e) {
    console.error('Offscreen: `live.connect` に失敗しました', e);
    return false;
  }
}

// --- Geminiからのメッセージ処理 ---
async function handleGeminiMessage(message) {
  try {
    const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
    if (audio) {
      const audioBuffer = await outputAudioContext.decodeAudioData(base64ToArrayBuffer(audio.data));
      const source = outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputAudioContext.destination);
      source.addEventListener('ended', () => { sources.delete(source); });

      const currentTime = outputAudioContext.currentTime;
      nextStartTime = Math.max(nextStartTime, currentTime);
      source.start(nextStartTime);
      nextStartTime += audioBuffer.duration;
      sources.add(source);
    }

    if (message.serverContent?.interrupted) {
      console.log('Offscreen: AIの音声が割り込みにより停止されました。');
      for (const source of sources.values()) {
        source.stop();
        sources.delete(source);
      }
      nextStartTime = 0;
    }
  } catch (e) {
    console.error('Offscreen: Geminiからのメッセージ処理中にエラー', e);
  }
}

// --- マイク録音の開始・停止 ---
async function startRecording() {
  if (isRecording) return;
  console.log('Offscreen: 録音開始処理 (ScriptProcessorNode)...');
  try {
    await inputAudioContext.resume();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    sourceNode = inputAudioContext.createMediaStreamSource(mediaStream);
    
    // 動作するサンプルに合わせてScriptProcessorNodeを使用
    const bufferSize = 256;
    scriptProcessorNode = inputAudioContext.createScriptProcessor(bufferSize, 1, 1);

    scriptProcessorNode.onaudioprocess = (event) => {
      if (!isRecording || !session) return;
      const pcmData = event.inputBuffer.getChannelData(0);
      try {
        session.sendRealtimeInput({ media: { blob: new Blob([pcmData.buffer]) } });
      } catch (e) {
        // このエラーは接続が閉じているときに頻発する可能性があるため、isRecording中のみログに出す
        if(isRecording) {
          console.error('Offscreen: 音声データの送信に失敗', e);
        }
      }
    };

    sourceNode.connect(scriptProcessorNode);
    scriptProcessorNode.connect(inputAudioContext.destination);
    isRecording = true;
    console.log('Offscreen: マイクのセットアップ完了 (ScriptProcessorNode)。');
  } catch (e) {
    console.error('Offscreen: マイクのセットアップに失敗', e);
  }
}

function stopRecording() {
  if (!isRecording) return;
  console.log('Offscreen: 録音停止処理...');
  isRecording = false; // ★最初にフラグを降ろす

  if (scriptProcessorNode) {
    scriptProcessorNode.disconnect();
    scriptProcessorNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (session) {
    session.close();
    session = null;
  }
  console.log('Offscreen: 全リソースを解放しました。');
}

// --- background.jsからのメッセージハンドラ ---
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'start-recording') {
    console.log('Offscreen: `start-recording`メッセージを受信');
    const success = await startSession();
    if (success) {
      await startRecording();
    }
  } else if (msg.type === 'stop-recording') {
    console.log('Offscreen: `stop-recording`メッセージを受信');
    stopRecording();
  }
});

// --- ヘルパー関数 ---
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- 初期化実行 ---
initialize();
// 初期化完了をbackground.jsに通知
chrome.runtime.sendMessage({ type: 'offscreen_ready' });
