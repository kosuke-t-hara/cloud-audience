// offscreen.js (リファクタリング版)

let audioContext;      // アプリケーションで唯一のAudioContext (16kHz)
let mediaStream;       // マイクからの生ストリーム
let workletNode;       // PCM変換を行うWorkletノード
let aiAudioSource = null; // AIの音声を再生中のSourceNodeを保持

// background.jsからのメッセージを待つ
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'start-recording':
      startRecording();
      break;
    case 'stop-recording':
      stopRecording();
      break;
    case 'play-audio':
      playAudio(msg.data);
      break;
  }
});

async function startRecording() {
  if (audioContext) return;
  console.log("Offscreen: 録音開始処理");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    // APIの入力仕様(16kHz)に合わせる
    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule('audio-processor.js');

    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
    source.connect(workletNode);
    workletNode.connect(audioContext.destination);

    workletNode.port.onmessage = (event) => {
      if (aiAudioSource) {
        aiAudioSource.stop();
        aiAudioSource = null;
        console.log("Offscreen: ユーザーの発話を検知し、AI音声を停止(割り込み)");
      }
      chrome.runtime.sendMessage({ type: 'audio_chunk', data: event.data });
    };
    console.log("Offscreen: 音声処理パイプライン構築完了");
  } catch (error) {
    console.error("Offscreen: 録音開始エラー:", error);
    chrome.runtime.sendMessage({ type: 'mic_error', error: { name: error.name, message: error.message } });
  }
}

function stopRecording() {
  console.log("Offscreen: 録音停止処理");
  if (aiAudioSource) {
    aiAudioSource.stop();
    aiAudioSource = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  workletNode = null;
  console.log("Offscreen: リソースを解放しました");
}

/**
 * PCM音声データをリサンプリングする
 * @param {Int16Array} pcmData - 入力PCMデータ
 * @param {number} inputRate - 入力サンプルレート (例: 24000)
 * @param {number} outputRate - 出力サンプルレート (例: 16000)
 * @returns {Int16Array} リサンプリングされたPCMデータ
 */
function resamplePcm(pcmData, inputRate, outputRate) {
  if (inputRate === outputRate) return pcmData;

  const ratio = inputRate / outputRate;
  const newLength = Math.round(pcmData.length / ratio);
  const result = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < pcmData.length; i++) {
      accum += pcmData[i];
      count++;
    }
    result[offsetResult] = Math.round(accum / count) || 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

// AIの音声データ(ArrayBuffer)を再生する関数
async function playAudio(audioData) {
  if (!audioContext) {
    console.error("AudioContextが初期化されていません。");
    return;
  }
  if (aiAudioSource) {
    aiAudioSource.stop();
  }

  try {
    const inputPcm = new Int16Array(audioData);// AIの音声データ(24kHz PCM)

    // Geminiからの音声(24kHz)を、AudioContext(16kHz)に合わせてリサンプリング
    const resampledPcm = resamplePcm(inputPcm, 24000, 16000);

    const audioBuffer = audioContext.createBuffer(1, resampledPcm.length, audioContext.sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < resampledPcm.length; i++) {
      channelData[i] = resampledPcm[i] / 32768.0; // Int16をFloat32に変換
    }

    aiAudioSource = audioContext.createBufferSource();
    aiAudioSource.buffer = audioBuffer;
    aiAudioSource.connect(audioContext.destination);
    aiAudioSource.onended = () => { aiAudioSource = null; };
    aiAudioSource.start();
    console.log("Offscreen: AIの音声再生を開始しました。");
  } catch (e) {
    console.error("音声の再生に失敗しました:", e);
  }
}
