import { GoogleGenAI, Modality } from './lib/gemini-sdk.js';

// --- DOM要素 ---
const stopButton = document.getElementById('stopButton');
const statusDiv = document.getElementById('status');

// --- 定数 ---
const GEMINI_API_KEY = 'AIzaSyBXYC5wZeheBszWRs6-kWn1jbqOqRLZyGY';
const MODEL_NAME = 'gemini-2.5-flash-preview-native-audio-dialog';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// --- グローバル変数 ---
let genAI;
let session;
let inputAudioContext;
let outputAudioContext;
let mediaStream;
let audioWorkletNode;
let sourceNode;
let isRecording = false;

// 音声再生キュー
const audioQueue = [];
let isPlaying = false;
const currentSourceRef = { current: null };

// --- メイン処理 ---
async function main() {
  updateStatus('Geminiクライアントを初期化しています...');
  const initSuccess = await initialize();
  if (!initSuccess) {
    updateStatus('エラー: オーディオプロセッサの初期化に失敗しました。');
    return;
  }

  updateStatus('Geminiとのセッションを開始します...');
  const sessionSuccess = await startSession();

  if (sessionSuccess) {
    updateStatus('マイクへのアクセスを要求します...');
    await startRecording();
  } else {
    updateStatus('エラー: Geminiセッションの開始に失敗しました。');
  }
}

// --- 初期化 ---
async function initialize() {
  try {
    genAI = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    });
    inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
    
    await inputAudioContext.audioWorklet.addModule('audio-processor.js');
    return true;
  } catch (e) {
    console.error('初期化中にエラーが発生しました:', e);
    return false;
  }
}

// --- Geminiセッション ---
async function startSession() {
  try {
    session = await genAI.live.connect({
      model: MODEL_NAME,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } },
      },
      tools: [{ googleSearch: {} }],
      callbacks: {
        onopen: () => updateStatus('Geminiとの接続が確立しました。'),
        onmessage: handleGeminiMessage,
        onerror: (error) => updateStatus(`エラー: ${error.message}`),
        onclose: () => {
          updateStatus('Geminiセッションが終了しました。');
          if (isRecording) stopRecording();
        },
      },
    });
    return true;
  } catch (e) {
    console.error('Geminiセッションの開始に失敗しました:', e);
    return false;
  }
}

async function handleGeminiMessage(message) {
  try {
    const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
    if (audio) {
      updateStatus('AIからの音声を受信しました。キューに追加します...');
      try {
        const audioBuffer = await decodeAudioData(decode(audio.data));
        audioQueue.push(audioBuffer);
        if (!isPlaying) {
          playNextAudio();
        }
      } catch (e) {
        console.error('音声のデコードに失敗しました:', e);
        updateStatus('エラー: 音声のデコードに失敗しました。');
      }
    }

    if (message.serverContent?.interrupted) {
      updateStatus('会話が中断されました。');
      if (currentSourceRef.current) {
        currentSourceRef.current.stop();
        currentSourceRef.current = null;
      }
      audioQueue.length = 0;
      isPlaying = false;
    }
  } catch (e) {
    console.error('AIの音声処理中にエラー:', e);
    updateStatus('エラー: AIの音声処理に失敗しました。');
  }
}

async function playNextAudio() {
  if (audioQueue.length === 0) {
    updateStatus('再生キューが空になりました。');
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const audioBuffer = audioQueue.shift();

  try {
    await outputAudioContext.resume();
    const source = outputAudioContext.createBufferSource();
    const gainNode = outputAudioContext.createGain();

    gainNode.gain.value = 0.9;

    source.buffer = audioBuffer;
    source.connect(gainNode);
    gainNode.connect(outputAudioContext.destination);
    currentSourceRef.current = source;

    source.onended = () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
      }
      isPlaying = false;
      playNextAudio();
    };

    source.start();
    updateStatus('AIからの音声を再生中です...');
  } catch (e) {
    console.error('音声の再生に失敗しました:', e);
    updateStatus('エラー: 音声の再生に失敗しました。');
    currentSourceRef.current = null;
    isPlaying = false;
    playNextAudio();
  }
}

// --- マイク処理 ---
async function startRecording() {
  if (isRecording) return;
  try {
    await inputAudioContext.resume();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    sourceNode = inputAudioContext.createMediaStreamSource(mediaStream);
    
    audioWorkletNode = new AudioWorkletNode(inputAudioContext, 'pcm-processor');
    
    audioWorkletNode.port.onmessage = (event) => {
      if (!isRecording || !session) return;
      const pcmData = new Uint8Array(event.data);
      try {
        session.sendRealtimeInput({
          media: {
            data: encode(pcmData),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          }
        });
      } catch (e) {
        if (isRecording) console.error('音声データの送信に失敗:', e);
      }
    };

    sourceNode.connect(audioWorkletNode);
    audioWorkletNode.connect(inputAudioContext.destination);
    isRecording = true;
    updateStatus('🔴 会話を開始しました。話しかけてみてください。');
  } catch (e) {
    console.error('マイクのセットアップに失敗:', e);
    updateStatus(`エラー: マイクへのアクセスに失敗しました - ${e.message}`);
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  updateStatus('セッションを終了しています...');

  if (audioWorkletNode) audioWorkletNode.disconnect();
  if (sourceNode) sourceNode.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
  if (session) session.close();

  audioWorkletNode = null;
  sourceNode = null;
  mediaStream = null;
  session = null;
  
  updateStatus('練習が終了しました。このタブは閉じて構いません。');
  stopButton.disabled = true;
}

// --- ヘルパー関数 ---
function encode(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data) {
  const numChannels = 1; // Geminiからの音声はモノラルと仮定

  // utils.ts の実装に完全に準拠し、先にバッファを作成
  const buffer = outputAudioContext.createBuffer(
    numChannels,
    data.length / 2 / numChannels,
    outputAudioContext.sampleRate
  );

  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
  const dataFloat32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    dataFloat32[i] = dataInt16[i] / 32768.0;
  }

  // utils.ts の実装に完全に準拠し、チャンネル分離ループを実装
  // (モノラルの場合は実質的に buffer.copyToChannel(dataFloat32, 0) と等価)
  for (let i = 0; i < numChannels; i++) {
    const channel = dataFloat32.filter((_, index) => index % numChannels === i);
    buffer.copyToChannel(channel, i);
  }

  return buffer;
}

function updateStatus(message) {
  console.log(message);
  statusDiv.textContent = message;
}

// --- イベントリスナー ---
stopButton.addEventListener('click', stopRecording);

// --- 実行開始 ---
main();
