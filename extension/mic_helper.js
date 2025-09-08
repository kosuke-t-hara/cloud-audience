// mic_helper.js (最終版)

(async function() {
  console.log("mic_helper.jsが読み込まれました");
  try {

    console.log("マイクの取得を試みています...");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });

    // --- ここからが映像キャプチャーのロジック ---
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.play();

    const canvasElement = document.createElement('canvas');
    const context = canvasElement.getContext('2d');

    const audioOnlyStream = new MediaStream();
    stream.getAudioTracks().forEach(track => audioOnlyStream.addTrack(track));

    const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });

    // 録音の最大時間を設定
    const MAX_RECORDING_DURATION = 45000; // 45秒に設定 (API制限の60秒より短く)
    let recordingTimer; // タイマーを保持する変数

    recorder.onstart = () => {
      console.log("録音チャンクを開始しました。");
      // 録音開始時に、最大録音時間を超えたら停止するタイマーをセット
      recordingTimer = setTimeout(() => {
        if (recorder.state === 'recording') {
          console.log("最大録音時間に達したため、音声を区切ります。");
          recorder.stop();
        }
      }, MAX_RECORDING_DURATION);
    };

    // 5秒ごとに音声を区切ってbackground.jsへ送信
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioOnlyStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    // 5秒に一度、フレームをキャプチャーしてbackground.jsに送る
    const frameCaptureInterval = setInterval(() => {
      // canvasのサイズをビデオに合わせる
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      // canvasに現在のビデオフレームを描画
      context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
      // canvasの内容を画像データ(JPEG)として取得
      const frameDataUrl = canvasElement.toDataURL('image/jpeg', 0.8);
      
      // background.jsにフレーム画像を送信
      chrome.runtime.sendMessage({ type: 'video_frame', data: frameDataUrl.split(',')[1] });

    }, 5000); // 5秒ごと
    // --- ここまで映像キャプチャーのロジック ---


    let silenceStart = performance.now();
    const SILENCE_THRESHOLD = 5000; // 無音と判断する音量のしきい値
    const PAUSE_DURATION = 3000; // 2秒の無音で「間」と判断
    console.log("音声の監視を開始します...");

    function detectSilence() {
      // アニメーションフレームは録音中のみ実行する（負荷軽減）
      if (recorder.state !== 'recording') {
        requestAnimationFrame(detectSilence);
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = dataArray.reduce((a, b) => a + b, 0);

      // console.log("現在の音量レベル:", sum);

      if (sum < SILENCE_THRESHOLD) {
        if (performance.now() - silenceStart > PAUSE_DURATION) {
          if (recorder.state === 'recording') {
            console.log("「間」を検知しました。音声を区切ります。");
            recorder.stop();
            silenceStart = performance.now(); 
          }
        }
      } else {
        silenceStart = performance.now();
      }
      requestAnimationFrame(detectSilence);
    }

    recorder.ondataavailable = (e) => {
      console.log("音声チャンクを取得しました。サイズ:", e.data.size);

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
      // (無音検知 or 時間制限のどちらで停止してもタイマーをクリア)
      clearTimeout(recordingTimer);
      
      // 停止したら、すぐに次の録音を開始
      if (audioOnlyStream.active) {
        recorder.start();
      }
    };
    
    // background.jsからの停止命令を待つ
    chrome.runtime.onMessage.addListener((request) => {
      if (request.type === 'stop_recording') {
        console.log("録音を停止します。");

        // カメラキャプチャーをクリア
        clearInterval(frameCaptureInterval);
        // 録音を停止
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
    console.error("マイクまたはカメラの取得に失敗");
    chrome.runtime.sendMessage({ 
      type: 'mic_error', 
      error: { 
        name: err.name,
        message: err.message
      } 
    });
  }
})();