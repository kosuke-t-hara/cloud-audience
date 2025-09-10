// mic_helper.js

(async function() {
  console.log("mic_helper.jsが読み込まれました");

  const urlParams = new URLSearchParams(window.location.search);
  const isFaceAnalysisEnabled = urlParams.get('faceAnalysis') === 'on';
  console.log("表情分析モード:", isFaceAnalysisEnabled ? "有効" : "無効");

  let stream = null;
  let frameCaptureInterval = null;
  let recorder = null;
  let audioContext = null;

  try {
    const constraints = { audio: true };
    if (isFaceAnalysisEnabled) {
      constraints.video = true;
    }
    console.log("メディアデバイスに要求する制約:", constraints);
    stream = await navigator.mediaDevices.getUserMedia(constraints);

    // --- 1. 音声処理のセットアップを先に行う ---
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error("音声トラックが見つかりません。");
    }
    const audioStream = new MediaStream(audioTracks);

    recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    const MAX_RECORDING_DURATION = 45000;
    let recordingTimer;

    recorder.onstart = () => {
      console.log("録音チャンクを開始しました。");
      recordingTimer = setTimeout(() => {
        if (recorder.state === 'recording') {
          console.log("最大録音時間に達したため、音声を区切ります。");
          recorder.stop();
        }
      }, MAX_RECORDING_DURATION);
    };

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    let silenceStart = performance.now();
    const SILENCE_THRESHOLD = 5000;
    const PAUSE_DURATION = 3000;

    function detectSilence() {
      if (recorder.state !== 'recording') {
        requestAnimationFrame(detectSilence);
        return;
      }
      analyser.getByteFrequencyData(dataArray);
      let sum = dataArray.reduce((a, b) => a + b, 0);
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
      if (e.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result.split(',')[1];
          chrome.runtime.sendMessage({ type: 'audio_chunk', data: base64Audio });
        };
        reader.readAsDataURL(e.data);
      }
    };

    recorder.onstop = () => {
      clearTimeout(recordingTimer);
      if (stream.active) { // 元のストリームがアクティブか確認
        recorder.start();
      }
    };

    // --- 2. 表情分析が有効な場合のみ、映像処理のセットアップを行う ---
    if (isFaceAnalysisEnabled && stream.getVideoTracks().length > 0) {
      console.log("映像トラックのセットアップを開始します。");
      const videoElement = document.createElement('video');
      videoElement.srcObject = stream;
      videoElement.muted = true;
      videoElement.play();

      const canvasElement = document.createElement('canvas');
      const context = canvasElement.getContext('2d');

      frameCaptureInterval = setInterval(() => {
        if (videoElement.readyState >= videoElement.HAVE_METADATA) {
          canvasElement.width = videoElement.videoWidth;
          canvasElement.height = videoElement.videoHeight;
          context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
          const frameDataUrl = canvasElement.toDataURL('image/jpeg', 0.8);
          chrome.runtime.sendMessage({ type: 'video_frame', data: frameDataUrl.split(',')[1] });
        }
      }, 5000);
    }

    // --- 3. 録音と監視を開始 ---
    recorder.start();
    detectSilence();
    console.log("Smart MediaRecorderによる音声処理を開始しました。");

  } catch (err) {
    console.error("マイクまたはカメラの取得に失敗:", err);
    chrome.runtime.sendMessage({
      type: 'mic_error',
      error: {
        name: err.name,
        message: err.message
      }
    });
  }

  // --- 4. 停止命令のリスナー ---
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'stop_recording') {
      console.log("録音を停止します。");
      if (frameCaptureInterval) {
        clearInterval(frameCaptureInterval);
      }
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (audioContext) {
        audioContext.close();
      }
      window.close();
    }
  });

})();