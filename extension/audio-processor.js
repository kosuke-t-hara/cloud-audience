// audio-processor.js

// 音声として検出するための音量のしきい値 (0.0 ～ 1.0)
// この値は調整が必要です。0.01 ～ 0.1 くらいから試してみてください。
const VAD_THRESHOLD = 0.05; 

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    // inputs[0][0] に Float32Array の音声データが含まれる
    const inputChannel = inputs[0][0];
    if (!inputChannel) {
      return true;
    }

    // Float32Array を Int16Array (16-bit PCM) に変換
    const buffer = new Int16Array(inputChannel.length);
    for (let i = 0; i < inputChannel.length; i++) {
      // 値を-1から1の範囲にクランプし、16ビット整数の範囲にスケール変換
      const s = Math.max(-1, Math.min(1, inputChannel[i]));
      buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 変換したPCMデータを offscreen.js に送信
    // 第二引数にバッファを指定することで、コピーではなく所有権を移動させ、効率化を図る
    this.port.postMessage(buffer.buffer, [buffer.buffer]);

    // プロセッサをアクティブに保つために true を返す
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
