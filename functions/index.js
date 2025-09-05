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
  console.log('クライアントが接続しました。');

  let liveSession;

  const startGeminiSession = async () => {
    try {
      const model = 'models/gemini-2.5-flash-preview-native-audio-dialog';

      liveSession = await ai.live.connect({
        model: model,
        config: {
          responseModalities: [Modality.AUDIO, Modality.TEXT],
        },
        callbacks: {
          onopen: () => console.log('Geminiとのライブセッションが開始されました。'),
          onmessage: (message) => {
            if (message.audio) {
              clientWs.send(message.audio);
            }
            if (message.text) {
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

    } catch (error) {
      console.error('Geminiライブセッションの開始に失敗しました:', error);
      clientWs.close(1011, 'Failed to start Gemini session.');
    }
  };

  startGeminiSession();

  // クライアントからのメッセージをGeminiに転送
  clientWs.on('message', (message) => {
    if (liveSession) {
      // 公式サンプルのsendClientContentはターンベースに見えるため、
      // ストリーミング用のメソッドとしてsendを試す
      liveSession.send({ audio: message });
    }
  });

  clientWs.on('close', () => {
    console.log('クライアント接続が切れました。');
    if (liveSession) {
      liveSession.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('クライアントのWebSocketでエラーが発生しました:', error);
    if (liveSession) {
      liveSession.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocketサーバーがポート${PORT}で起動しました。`);
});