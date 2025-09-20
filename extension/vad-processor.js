// extension/vad-processor.js

try {
  /**
   * Voice Activity Detection (VAD) を行う AudioWorkletProcessor。
   * currentTime を使って経過時間を直接計測する、より堅牢な実装。
   */
  class VadProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const { silenceThreshold, pauseDuration } = options.processorOptions;
      this._silenceThreshold = silenceThreshold || 0.01;
      this._pauseDurationSeconds = (pauseDuration || 3000) / 1000; // ミリ秒を秒に変換
      this._isSilent = false;
      this._silenceStartTime = 0; // 無音開始時間を記録する変数
      this._isPaused = false; // ★ 一時停止状態

      console.log(`[VADProcessor] constructor: 初期化完了。`);
      console.log(`[VADProcessor] > 渡された設定: silenceThreshold=${this._silenceThreshold}, pauseDuration=${this._pauseDurationSeconds}秒`);

      this.port.onmessage = (event) => {
        if (event.data === 'reset') {
          this._isSilent = false;
          this._silenceStartTime = 0;
          console.log("[VADProcessor] onmessage: 状態をリセットしました。");
        } else if (event.data === 'pause') {
          this._isPaused = true;
          console.log("[VADProcessor] onmessage: 検知を一時停止しました。");
        } else if (event.data === 'resume') {
          this._isPaused = false;
          this._silenceStartTime = 0; // タイマーもリセット
          this._isSilent = false;
          console.log("[VADProcessor] onmessage: 検知を再開しました。");
        }
      };
    }

    process(inputs, outputs, parameters) {
      // ★ 一時停止中はすべての処理をスキップ
      if (this._isPaused) {
        return true;
      }

      const input = inputs[0];
      if (input && input.length > 0 && input[0].length > 0) {
        const channelData = input[0];
        let sum = 0.0;
        for (let i = 0; i < channelData.length; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);

        // 常に現在の音量レベルをヘルパーに送信する
        this.port.postMessage({ type: 'volume', rms: rms });

        if (rms < this._silenceThreshold) {
          // 無音状態が始まった瞬間、または継続している
          if (this._silenceStartTime === 0) {
            // 無音開始時間を記録
            this._silenceStartTime = currentTime;
            console.log(`[VADProcessor] 無音状態を開始 (RMS=${rms.toFixed(5)})`);
          } else {
            const elapsedTime = currentTime - this._silenceStartTime;
            // console.log(`[VADProcessor] 無音継続中... ${elapsedTime.toFixed(2)} / ${this._pauseDurationSeconds} 秒`);

            if (elapsedTime >= this._pauseDurationSeconds && !this._isSilent) {
              console.log(`[VADProcessor] process: ${this._pauseDurationSeconds}秒間の無音を検知しました。メッセージを送信します。`);
              this.port.postMessage('silence');
              this._isSilent = true;
            }
          }
        } else {
          // 音声が検知された
          if (this._silenceStartTime > 0) {
             console.log(`[VADProcessor] process: 音声を検知しました (RMS=${rms.toFixed(5)})。無音タイマーをリセットします。`);
          }
          this._silenceStartTime = 0; // タイマーリセット
          this._isSilent = false;
        }
      }
      return true;
    }
  }

  registerProcessor('vad-processor', VadProcessor);
} catch (error) {
  console.error("vad-processor.js のグローバルスコープでエラーが発生しました:", error);
  throw error;
}
