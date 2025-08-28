// mic_helper.js (最終版)

(async function() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    // 5秒ごとに音声を区切ってbackground.jsへ送信
    const interval = 10000;
    const recordingInterval = setInterval(() => {
      if (recorder.state === 'recording') recorder.stop();
      if (recorder.state === 'inactive') recorder.start();
    }, interval);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        // BlobデータをBase64に変換して送信
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result.split(',')[1];
          chrome.runtime.sendMessage({ type: 'audio_chunk', data: base64Audio });
        };
        reader.readAsDataURL(e.data);
      }
    };
    
    // background.jsからの停止命令を待つ
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'stop_recording') {
        clearInterval(recordingInterval);
        if (recorder.state === 'recording') recorder.stop();
        stream.getTracks().forEach(track => track.stop());
        window.close();
      }
    });

    recorder.start();
    console.log("マイク録音ヘルパーが起動しました。");

  } catch (err) {
    console.error("マイクの取得に失敗:", err);
    chrome.runtime.sendMessage({ type: 'mic_error', error: err.message });
    window.close();
  }
})();