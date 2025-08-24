chrome.runtime.onMessage.addListener((request) => {
  if (request.target !== 'offscreen') return;

  if (request.type === 'start-recording') {
    startRecording();
  } else if (request.type === 'stop-recording') {
    stopRecording();
  }
});

let recorder;
let data = [];

async function startRecording() {
  // recorderが既に動いている場合は何もしない
  if (recorder?.state === 'recording') {
    console.log('既に録音中です。');
    return;
  }
  
  try {
    // ユーザーにマイク使用許可を求める
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // --- 許可された場合の処理 ---
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      console.log("録音停止。");
    };
    
    // (5秒ごとに区切る処理などは、元のコードのままでOK)
    const fiveSeconds = 5000;
    recordingInterval = setInterval(() => {
      if (recorder.state === 'recording') recorder.stop();
      if (recorder.state === 'inactive') recorder.start();
    }, fiveSeconds);

    recorder.ondataavailable = async (e) => {
      // ... (元のコードのままでOK) ...
    };

    recorder.start();
    console.log("マイク録音を開始しました。");

  } catch (error) {
    // --- 拒否された場合や、エラーが発生した場合の処理 ---
    if (error.name === 'NotAllowedError') {
      console.error("マイクの使用が許可されませんでした。ユーザーが拒否しました。");
    } else {
      console.error("マイクの起動中にエラーが発生しました:", error);
    }
  }
}

function stopRecording() {
  recorder?.stop();
}