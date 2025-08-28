// audio-processor.js

class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    // 1チャンネル目の音声データを取得 (Float32Array)
    const input = inputs[0][0]; 
    if (input) {
      // データをbackground.jsに送信
      this.port.postMessage(input);
    }
    return true;
  }
}
registerProcessor('audio-processor', AudioProcessor);