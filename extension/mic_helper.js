// mic_helper.js

(async function() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Web Audio APIの準備
    const audioContext = new AudioContext();
    // AudioWorkletのモジュールを登録
    const processUrl = chrome.runtime.getURL('audio-processor.js');
    await audioContext.audioWorklet.addModule(processUrl);
    
    const microphoneSource = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

    // Workletから送られてくる音声データをbackground.jsに転送
    workletNode.port.onmessage = (event) => {
      chrome.runtime.sendMessage({ type: 'audio_stream', data: event.data });
    };
    
    microphoneSource.connect(workletNode);

    // background.jsからの停止命令を待つ
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'stop_recording') {
        stream.getTracks().forEach(track => track.stop());
        audioContext.close();
        window.close();
      }
    });

    console.log("Web Audio APIによる音声処理を開始しました。");

  } catch (err) {
    console.error("マイクの取得またはAudioWorkletの初期化に失敗:", err);
    chrome.runtime.sendMessage({ type: 'mic_error', error: err.message });
  }
})();