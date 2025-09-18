// mic_helper.js

(async function() {
  console.log("mic_helper.jsが読み込まれました");

  const urlParams = new URLSearchParams(window.location.search);
  const isFaceAnalysisEnabled = urlParams.get('faceAnalysis') === 'on';
  console.log("表情分析モード:", isFaceAnalysisEnabled ? "有効" : "無効");

  let stream = null;
  let recorder = null;
  let audioContext = null;
  let vadNode = null; // vadNodeをグローバルスコープでアクセス可能に

  try {
    const constraints = {
      audio: {
        sampleRate: 48000,
        noiseSuppression: true,
        echoCancellation: true
      }
    };
    if (isFaceAnalysisEnabled) {
      constraints.video = true;
    }
    console.log("メディアデバイスに要求する制約:", constraints);
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log("[mic_helper] getUserMedia 成功");

    const audioStream = new MediaStream(stream.getAudioTracks());
    const mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      console.error(`${mimeType} はサポートされていません。`);
      return;
    }
    recorder = new MediaRecorder(audioStream, { mimeType: mimeType });
    console.log("[mic_helper] MediaRecorderの初期化完了");

    // [エラーハンドリング強化] AudioWorkletのセットアップ
    try {
      audioContext = new AudioContext({ sampleRate: 48000 });
      audioContext.onprocessorerror = (event) => {
        console.error(`[AudioContext] processorerrorイベント:`, event);
      };

      console.log("[mic_helper] AudioWorkletモジュールを読み込みます: vad-processor.js");
      await audioContext.audioWorklet.addModule('vad-processor.js');
      console.log("[mic_helper] AudioWorkletモジュールの読み込みに成功しました。");

      // ★★★ 追加: ストレージから設定値を読み込む ★★★
      const settings = await new Promise(resolve => {
        chrome.storage.local.get({ silenceThreshold: 0.02, pauseDuration: 5 }, result => resolve(result));
      });
      const silenceThreshold = parseFloat(settings.silenceThreshold);
      const pauseDuration = parseInt(settings.pauseDuration, 10) * 1000; // 秒をミリ秒に変換
      console.log(`[mic_helper] ストレージから読み込んだsilenceThreshold: ${silenceThreshold}`);
      console.log(`[mic_helper] ストレージから読み込んだpauseDuration: ${pauseDuration}ms`);

      const source = audioContext.createMediaStreamSource(audioStream);
      vadNode = new AudioWorkletNode(audioContext, 'vad-processor', {
        processorOptions: {
          silenceThreshold: silenceThreshold, // ★ 読み込んだ値を使用
          pauseDuration: pauseDuration       // ★ 読み込んだ値を使用
        }
      });
      console.log("[mic_helper] AudioWorkletNodeの作成完了");

      let isSpeaking = false;
      const speakingThreshold = 0.02; // 発話検知のしきい値

      vadNode.onprocessorerror = (event) => {
        console.error(`[VADNode] onprocessorerrorイベント:`, event);
      };

      vadNode.port.onmessage = (event) => {
        // 音量レベルのメッセージを処理
        if (event.data.type === 'volume') {
          const newSpeakingStatus = event.data.rms > speakingThreshold;
          if (newSpeakingStatus !== isSpeaking) {
            isSpeaking = newSpeakingStatus;
            const status = isSpeaking ? 'speaking' : 'silent';
            // console.log(`[mic_helper] Speaking status changed to: ${status}`); // デバッグ用
            chrome.runtime.sendMessage({ type: 'speaking_status', status: status });
          }
          return; // volumeメッセージはここで処理終了
        }

        // 既存の無音検知メッセージを処理
        // ★★★ デバッグログ ★★★
        console.log(`[mic_helper] VADNodeからメッセージを受信:`, event.data);
        if (event.data === 'silence') {
          // ★★★ 追加: ストップウォッチを停止し、経過時間を表示 ★★★
          console.timeEnd("VAD Silence Timer"); 
          
          if (recorder.state === 'recording') {
            console.log("[mic_helper] 無音を検知。recorder.stop()を呼び出します。");
            recorder.stop();
          } else {
            console.warn("[mic_helper] 無音を検知しましたが、recorderの状態が 'recording' ではありませんでした。現在の状態:", recorder.state);
          }
        }
      };
      console.log("[mic_helper] VADNodeのポートにメッセージリスナーを設定しました。");

      source.connect(vadNode);
      vadNode.connect(audioContext.destination);
      console.log("[mic_helper] AudioWorkletのセットアップが正常に完了しました。");

    } catch (error) {
      console.error("AudioWorkletのセットアップ中に致命的なエラーが発生しました:", error);
      alert("無音検知機能の初期化に失敗しました。詳細はコンソールを確認してください。");
    }

    // MediaRecorderのイベントハンドラ
    recorder.ondataavailable = (e) => {
      // ★★★ デバッグログ ★★★
      console.log(`[mic_helper] ondataavailableイベント発生: データサイズ=${e.data.size}`);
      if (e.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result.split(',')[1];
          // ★★★ デバッグログ ★★★
          console.log(`[mic_helper] Base64エンコード完了。background.jsに送信します。データ長=${base64Audio.length}`);
          chrome.runtime.sendMessage({ type: 'audio_chunk', data: base64Audio });
        };
        reader.readAsDataURL(e.data);
      } else {
        console.log("[mic_helper] ondataavailable: データサイズが0のため送信しません。");
      }
    };

    recorder.onstop = () => {
      // ★★★ デバッグログ ★★★
      console.log("[mic_helper] onstopイベント発生。");
      if (stream.active) {
        if (vadNode) {
          console.log("[mic_helper] VADプロセッサの状態をリセットします。");
          vadNode.port.postMessage('reset');
        }
        console.log("[mic_helper] recorder.start()を呼び出して録音を再開します。");
        recorder.start();
        
        // ★★★ 追加: ストップウォッチを開始 ★★★
        console.time("VAD Silence Timer");

      } else {
        console.log("[mic_helper] onstop: ストリームがアクティブでないため、録音は再開しません。");
      }
    };

    recorder.start();
    // ★★★ 追加: ストップウォッチを初回開始 ★★★
    console.time("VAD Silence Timer");
    console.log(`[mic_helper] recorder.start() を初回呼び出し。録音を開始しました。現在の状態: ${recorder.state}`);

  } catch (err) {
    console.error("[mic_helper] 初期化処理中にエラーが発生:", err);
  }

  // 停止命令のリスナー
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'stop_recording') {
      console.log("[mic_helper] 録音停止命令を受信");
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        console.log("[mic_helper] 全てのメディアトラックを停止しました。");
      }
      if (recorder && recorder.state === 'recording') {
        console.log("[mic_helper] recorder.stop() を呼び出します (最終)。");
        recorder.stop();
      }
      if (audioContext) {
        audioContext.close();
        console.log("[mic_helper] AudioContextを閉じました。");
      }
      window.close();
    }
  });

})();