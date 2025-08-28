// mic_helper.js (最終版)

(async function() {
  console.log("mic_helper.jsが読み込まれました");
  try {

    console.log("マイクの取得を試みています...");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    // 5秒ごとに音声を区切ってbackground.jsへ送信
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    let silenceStart = performance.now();
    const SILENCE_THRESHOLD = 5000; // 無音と判断する音量のしきい値
    const PAUSE_DURATION = 2000; // 2秒の無音で「間」と判断
    console.log("音声の監視を開始します...");

    function detectSilence() {
      analyser.getByteFrequencyData(dataArray);
      let sum = dataArray.reduce((a, b) => a + b, 0);

      console.log("現在の音量レベル:", sum);

      if (sum < SILENCE_THRESHOLD) {
        if (performance.now() - silenceStart > PAUSE_DURATION) {
          if (recorder.state === 'recording') {
            console.log("「間」を検知しました。音声を区切ります。");
            recorder.stop();
          }
        }
      } else {
        silenceStart = performance.now();
      }
      requestAnimationFrame(detectSilence);
    }

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

    recorder.onstop = () => {
      // 停止したら、すぐに次の録音を開始
      if (stream.active) {
        recorder.start();
      }
    };
    
    // background.jsからの停止命令を待つ
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'stop_recording') {
        clearInterval(recordingInterval);
        if (recorder.state === 'recording') recorder.stop();
        stream.getTracks().forEach(track => track.stop());
        audioContext.close();
        window.close();
      }
    });

    recorder.start();
    detectSilence(); // 音量監視を開始
    console.log("Smart MediaRecorderによる音声処理を開始しました。");

  } catch (err) {
    console.error("マイクの取得に失敗:", err);
    chrome.runtime.sendMessage({ type: 'mic_error', error: err.message });
  }
})();