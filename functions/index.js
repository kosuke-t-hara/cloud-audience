// functions/index.js (公式サンプル適用版)

const http = require('http');
const { WebSocketServer } = require('ws');
const { GoogleGenAI, Modality } = require('@google/genai');

// --- 環境変数と定数 ---
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Geminiのセットアップ ---
if (!GEMINI_API_KEY) {
  throw new Error("環境変数にGEMINI_API_KEYが設定されていません。");
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- サーバーのセットアップ ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Prezento AI Sparring PartnerのWebSocketサーバー');
});
const wss = new WebSocketServer({ server });

// --- WebSocket接続のハンドリング ---
wss.on('connection', (clientWs) => {
  console.log(' ');
  console.log('- ★ - ★ - ★ - ★ - ★ - ★ - ★ -');
  console.log(' ');
  console.log('クライアントが接続しました。');

  let liveSession;
  let isSessionStarting = false; // セッション開始中の多重呼び出しを防ぐフラグ
  let audioQueue = []; 

  const startGeminiSession = async () => {
    isSessionStarting = true; // 開始処理中
    try {
      const model = 'gemini-2.5-flash-preview-native-audio-dialog';

      liveSession = await ai.live.connect({
        model: model,
        config: {
          responseModalities: [Modality.AUDIO, Modality.TEXT],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Zephyr',
              }
            }
          }
        },
        callbacks: {
          onopen: () => console.log('Geminiとのライブセッションが開始されました。'),
          onmessage: (message) => {
            console.log(' ★ Geminiからメッセージを受信:', message);
            if (message.audio) {
              console.log(' 音声メッセージを送信:');
              const audioBase64 = Buffer.from(message.audio).toString('base64');
              clientWs.send(JSON.stringify({ type: 'audio', data: audioBase64 }));
            }
            if (message.text) {
              console.log(' 文字起こしメッセージを送信:');
              clientWs.send(JSON.stringify({ type: 'transcript', data: message.text }));
            }
          },
          onerror: (error) => {
            console.error('Geminiセッションでエラーが発生しました:', error);
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.close(1011, 'Gemini session error.');
            }
          },
          onclose: () => {
            console.log('Geminiセッションが終了しました。');
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.close(1000, 'Gemini session closed.');
            }
          },
        },
      });
      console.log(`Geminiセッションをモデル ${model} で確立しました。`);

      // ★ プロンプトと最初のチャンクを同時に送信 -> プロンプト送信を一旦やめる
      const firstChunk = audioQueue.shift(); // キューから最初のチャンクを取り出す
      if (!firstChunk) {
        throw new Error("セッション開始時に音声キューが空です。");
      }

      console.log('最初の音声チャンクを送信します...');
      const firstChunkData = firstChunk.toString('base64');
      liveSession.sendClientContent({
        inlineData: {
          mimeType: 'audio/pcm;rate=16000',
          data: firstChunkData
        }
      });

      console.log(`接続完了。残りの ${audioQueue.length} 個のチャンクを送信します...`);

      for (const chunk of audioQueue) {
        if (liveSession) { // 途中で切断された場合に備える
          const data = chunk.toString('base64');
          liveSession.sendClientContent({
            inlineData: {
              mimeType: 'audio/pcm;rate=16000',
              data: data
            }
          });
        } else {
          console.warn('スロットリング処理中にセッションが切断されました。');
          break; // ループを抜ける
        }
      }

      console.log('キューの送信が完了しました。ライブストリーミングに移行します。');
      audioQueue = [];

    } catch (error) {
      console.error('Geminiライブセッションの開始に失敗しました:', error);
      clientWs.close(1011, 'Failed to start Gemini session.');
      audioQueue = [];
    } finally {
      isSessionStarting = false; // 成功・失敗どちらでもフラグを下ろす
    }
  };

  // クライアントからのメッセージをGeminiに転送
  clientWs.on('message', async (message) => {
    // ★ 空のメッセージは無視する
    if (message.length === 0) {
      console.log('空のメッセージを受信したため、無視します。');
      return;
    }

    try {
      const MIN_CHUNKS_TO_START = 50; // セッション開始に必要なチャンク数

      if (!liveSession && !isSessionStarting) {
        audioQueue.push(message);
        if (audioQueue.length >= MIN_CHUNKS_TO_START) {
            console.log(`${audioQueue.length}個のオーディオチャンクを受信。キューに追加し、Geminiセッションを開始します...`);
            startGeminiSession();
        }
      } else if (isSessionStarting) {
        audioQueue.push(message);
      } else if (liveSession && liveSession.sendClientContent) {
        const data = message.toString('base64');
        liveSession.sendClientContent({
          inlineData: {
            mimeType: 'audio/pcm;rate=16000',
            data: data
          }
        });
      }
    } catch (error) {
      console.error('クライアントからのメッセージ処理中にエラーが発生しました:', error);
      clientWs.close(1011, 'Message processing error');
    }
  });

  clientWs.on('close', () => {
    console.log('クライアント接続が切れました。');
    if (liveSession) {
      liveSession.close();
      liveSession = null;
    }
    audioQueue = []; // 念のためクリア
    isSessionStarting = false;
  });

  clientWs.on('error', (error) => {
    console.error('クライアントのWebSocketでエラーが発生しました:', error);
    if (liveSession) {
      liveSession.close();
      liveSession = null;
    }
    audioQueue = []; // 念のためクリア
    isSessionStarting = false;
  });
});

server.listen(PORT, () => {
  console.log(`WebSocketサーバーがポート${PORT}で起動しました。`);
});
