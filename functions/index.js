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
      const model = 'models/gemini-live-2.5-flash-preview';
      // const model = 'models/gemini-2.5-flash-live-preview';

      liveSession = await ai.live.connect({
        model: model,
        config: {
          responseModalities: [Modality.AUDIO],
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
            console.log('Geminiからメッセージを受信:', message);
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

      // AIに「役割」を与えるための指示テキストを送信する
      // console.log('AIに役割(プロンプト)を送信します...');
      // liveSession.sendClientContent({
      //   turns: [{ 
      //     text: "あなたは優秀な会話パートナーです。単にユーザーの発話に応答するだけでなく、あなたからも自由に話題を広げたり、関連する質問をしたりして、会話全体をリードしてください。" 
      //   }]
      // });

      console.log(`接続完了。キューイングされた ${audioQueue.length} 個のチャンクを送信します...`);

      // ★★★ スロットリング（速度調整）処理を追加 ★★★
      // 1チャンクあたりの時間 (128サンプル / 16000 Hz * 1000ms ≈ 8ms)
      // 負荷なども考慮し、少し余裕を持たせるか、キリの良い値（例: 10ms）にします。
      const CHUNK_INTERVAL_MS = 10;

      for (const chunk of audioQueue) {
        if (liveSession) { // 途中で切断された場合に備える
          // ★ データをBase64に変換し、MIMEタイプを指定したオブジェクトでラップする
          const data = chunk.toString('base64');
          liveSession.sendClientContent({
            inlineData: {
              // ★★★ APIが期待する 16kHz を指定 ★★★
              mimeType: 'audio/pcm;rate=16000',
              data: data
            }
          });
          // 各チャンクの間に、リアルタイム相当の待機時間（インターバル）を入れる
          await new Promise(resolve => setTimeout(resolve, CHUNK_INTERVAL_MS));
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
    try {
      // 1. セッションがまだ確立されておらず、開始処理中でもない場合
      //    (＝これが最初の音声メッセージ)
      if (!liveSession && !isSessionStarting) {
        console.log('最初のオーディオチャンクを受信。キューに追加し、Geminiセッションを開始します...');
        isSessionStarting = true;
        audioQueue.push(message);
        // ★ ここで初めてGeminiセッションを開始する
        startGeminiSession(); 
      } else if (isSessionStarting) {
        // console.warn('Geminiセッション確立中。チャンクをキューに追加します。'); 
        // (ログが多すぎる場合はコメントアウト)
        audioQueue.push(message); // ★ 破棄せず、キューに追加する
      } else if (liveSession && liveSession.sendClientContent) {
        // ★ ライブ送信時も同様にBase64 + MIMEタイプでラップする
        const data = message.toString('base64');
        liveSession.sendClientContent({
          inlineData: {
            mimeType: 'audio/pcm;rate=16000', // Linear16 PCM @ 16kHz
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