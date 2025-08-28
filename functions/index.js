// functions/index.js

const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const cors = require('cors')({origin: true});

// Google Cloudクライアントライブラリ
const { SpeechClient } = require('@google-cloud/speech').v1; // `.v1` を追記
const { LanguageServiceClient } = require('@google-cloud/language');

// Gemini APIキーを環境変数から取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL = 'gemini-1.5-flash-001';

// 認証情報を使ってクライアントを初期化
const speechClient = new SpeechClient();
const languageClient = new LanguageServiceClient();

// Gemini Vision関数 (リアルタイムフィードバック用)
async function getGeminiVisionFeedback(text, image, mode, history) {
  if (!text) return null;

  let prompt;
  let requestBody;

  switch (mode) {
    case 'dialogue':
      // AIの性格やルールを定義する「システム指示」
      const systemInstruction = {
        parts: [{ text: `
          あなたは、関西弁でツッコミとボケの名手「サトシ」です。
          あなたの役割は、ユーモアのある会話のキャッチボールを続けることです。
          応答は必ず5文以内にしてください。
        `}]
      };

      // これまでの対話履歴に、最新の発言（テキスト＋画像）を追加
      const newHistory = [
        ...history,
        { 
          role: 'user', 
          parts: [
            { text: text },
            { inline_data: { mime_type: 'image/jpeg', data: image } }
          ] 
        }
      ];

      requestBody = {
        contents: newHistory,
        systemInstruction: systemInstruction
      };
      break;
    case 'creator':
      prompt = `あなたは辛口のYouTubeプロデューサーです。この画面と発話者の「${text}」という発言内容を踏まえ、視聴者が面白がるような、ユーモアのある短いツッコミを一つ生成してください。`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
    case 'thinking':
      prompt = `あなたは優秀な聞き手です。発話者の「${text}」という発言内容を肯定的に受け止め、「なるほど」「面白いですね」といった短い相槌か、思考を促すための「それは具体的には？」のような短い質問を一つ生成してください。`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
    case 'presenter':
    default:
      prompt = `あなたは冷静なプレゼンの聴衆です。このスライド画像と、発表者の「${text}」という発言内容を踏まえ、80文字以内で短いコメントを一つだけ生成してください。`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const data = await response.json();
    if (data.candidates && data.candidates.length > 0) {
      return data.candidates[0].content.parts[0].text;
    }
  } catch (error) {
    console.error('Gemini Vision APIエラー:', error);
  }
  return null;
}

// Gemini Summary関数 (サマリーレポート用)
async function getGeminiSummary(transcript, sentiment, mode) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

  let prompt;
  switch (mode) {
    case 'creator':
      prompt = `
        あなたは敏腕YouTubeプロデューサーです。
        以下の「文字起こしデータ」と「感情分析スコア」を分析し、必ず以下のJSON形式にのみ従って評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: "最も良かった点を含めて800字以内で記述"
        - advice: "改善点を800字以内で記述"

        # 感情分析スコア
        ${JSON.stringify(sentiment)}

        # 出力形式 (JSON)
        {
          "scores": {
            "hook_strength": <number>,
            "entertainment": <number>,
            "pacing": <number>,
            "killer_phrase": <number>,
            "safety_risk": <number>
          },
          "highlight": "<string>",
          "advice": "<string>"
        }

        # 文字起こしデータ
        ${transcript}
      `;
      break;
    case 'thinking':
      prompt = `
        あなたは優秀な壁打ち相手です。
        以下の思考の独り言の「文字起こしデータ」を要約し、必ず以下のJSON形式にのみ従って出力してください。

        # 出力形式 (JSON)
        {
          "key_points": ["キーポイントを3つ、箇条書きの配列で"],
          "new_ideas": ["そこから発展する可能性のある新しいアイデアを3つ、箇条書きの配列で"],
          "summary_text": "セッション全体の要約を、美しい比喩を用いながら800字以内で記述"
        }
        
        # 文字起こしデータ
        ${transcript}
      `;
      break;
    case 'presenter':
    default:
      prompt =  `
        あなたは経験豊富なプレゼンテーションのコーチです。
        以下の「文字起こしデータ」と、その内容の「感情分析スコア」を総合的に分析し、必ず以下のJSON形式にのみ従って評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: "最も良かった点を含めて800字以内で記述"
        - advice: "改善点を800字以内で記述"

        # 感情分析スコアについて
        - score: テキスト全体のポジティブ度(-1.0~1.0)。高いほど熱意がありポジティブ。
        - magnitude: テキスト全体の感情の大きさ。大きいほど感情豊か。
        - sentimentResult: ${JSON.stringify(sentiment)}

        # 評価基準
        - 明朗さ: 話し方が明確で論理的か。
        - 情熱度: 話し方から熱意が感じられるか。上記の感情分析スコアを最重視して評価してください。
        - 示唆度: 内容に深みや有益な情報があるか。
        - 構成力: 全体の流れがスムーズか。
        - 自信: よどみなく堂々と話せているか。

        # 出力形式 (JSON)
        {
          "scores": {
            "clarity": <number>,
            "passion": <number>,
            "insightfulness": <number>,
            "structure": <number>,
            "confidence": <number>
          },
          "highlight": "<string>",
          "advice": "<string>"
        }

        # 文字起こしデータ
        ${transcript}
      `;
  }

  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    const data = await response.json();
    if (data.candidates && data.candidates.length > 0) {
      const jsonString = data.candidates[0].content.parts[0].text;
      const match = jsonString.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    }
  } catch (error) {
    console.error('Gemini Summary APIエラー:', error);
  }
  return null;
}

// --- HTTPサーバーの作成 ---
const server = http.createServer((req, res) => {
  // CORSを適用し、HTTPリクエストを処理
  cors(req, res, () => {
    // POSTリクエストで、かつ特定のパスの場合のみ処理
    if (req.method === 'POST' && (req.url === '/feedback' || req.url === '/summary')) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const requestData = JSON.parse(body);
          let responseData;

          if (req.url === '/feedback') {
            // リアルタイムフィードバックの処理
            responseData = await getGeminiVisionFeedback(
              requestData.transcript, 
              requestData.imageContent, 
              requestData.mode, 
              requestData.history
            );
          } else if (req.url === '/summary') {
            // サマリーレポートの処理
            const sentiment = await analyzeTextSentiment(requestData.transcript);
            responseData = await getGeminiSummary(
              requestData.transcript, 
              sentiment, 
              requestData.mode
            );
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseData));

        } catch (error) {
          console.error("HTTPリクエスト処理エラー:", error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
    } else {
      // POSTや指定パス以外は404を返す
      res.writeHead(404);
      res.end();
    }
  });
});

// --- WebSocketサーバーのセットアップ ---
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('クライアントが接続しました。');
  let recognizeStream = null;
  let currentMode = 'presenter'; // 各接続のモードを保持

  ws.on('message', async (message) => {
    try {
      // まずはテキストメッセージ（設定情報）として解析を試みる
      const msg = JSON.parse(message);
      if (msg.type === 'start_session') {
        currentMode = msg.mode || 'presenter';
        if (recognizeStream) recognizeStream.end();
        
        recognizeStream = speechClient.streamingRecognize({
            config: {
              encoding: 'WEBM_OPUS',
              sampleRateHertz: 48000,
              languageCode: 'ja-JP',
            },
            interimResults: true,
          })
          .on('error', (err) => {
            console.error('Speech-to-Textストリームエラー:', err);
          })
          .on('data', (data) => {
            const transcript = data.results[0]?.alternatives[0]?.transcript || '';
            const isFinal = data.results[0]?.isFinal || false;
            
            // 確定したテキストのみをクライアントに送り返す
            if (isFinal && transcript) {
              ws.send(JSON.stringify({
                type: 'final_transcript',
                transcript: transcript,
                mode: currentMode // 現在のモードも一緒に返す
              }));
            }
          });
      } else if (msg.type === 'end_session') {
        if (recognizeStream) recognizeStream.end();
        recognizeStream = null;
      }
    } catch (e) {
      // JSONとして解析できなければ、音声データとして扱う
      if (Buffer.isBuffer(message) && recognizeStream) {
        recognizeStream.write(message);
      }
    }
  });

  ws.on('close', () => {
    console.log('クライアントが切断しました。');
    if (recognizeStream) recognizeStream.end();
  });
});

// --- サーバーの起動 ---
const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`サーバーがポート ${port} で起動しました。`);
});

// Natural Language API関数 (感情分析用)
async function analyzeTextSentiment(text) {
  const document = {
    content: text,
    type: 'PLAIN_TEXT',
    language: 'ja'
  };

  try {
    const [result] = await languageClient.analyzeSentiment({document: document});
    console.log("Natural Language API 感情分析結果:", result.documentSentiment);
    return result.documentSentiment;
  } catch (error) {
    console.error('Natural Language APIエラー:', error);
    return null;
  }
}
