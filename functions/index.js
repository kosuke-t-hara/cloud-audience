// functions/index.js
const functions = require('@google-cloud/functions-framework');
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
async function getGeminiVisionFeedback(text, image, mode) {
  if (!text) return null;

  let prompt;
  switch (mode) {
    case 'creator':
      prompt = `あなたは辛口のYouTubeプロデューサーです。このスライドと発表者の「${text}」という発言内容を踏まえ、視聴者が面白がるような、ユーモアのある短いツッコミを一つ生成してください。`;
      break;
    case 'thinking':
      prompt = `あなたは優秀な聞き手です。発表者の「${text}」という発言内容を肯定的に受け止め、「なるほど」「面白いですね」といった短い相槌か、思考を促すための「それは具体的には？」のような短い質問を一つ生成してください。`;
      break;
    case 'presenter':
    default:
      prompt = `あなたはプレゼンの聴衆かつ冷静でリズム感がよいです。このスライド画像と、発表者の「${text}」という発言内容を踏まえ、80文字以内で短いコメントを一つだけ生成してください。`;
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const requestBody = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: image } }
    ]}]
  };

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
        以下の「文字起こしデータ」と「感情分析スコア」を分析し、次のJSON形式で評価を出力してください。

        # 感情分析スコア
        ${JSON.stringify(sentiment)}

        # 出力形式 (JSON)
        {
          "scores": {
            "hook_strength": [1-100の整数],
            "entertainment": [1-100の整数],
            "pacing": [1-100の整数],
            "killer_phrase": [1-100の整数],
            "safety_risk": [1-100の整数]
          },
          "highlight": "最も良かった点を200字以内で記述",
          "advice": "改善点を一つだけ200字以内で記述"
        }

        # 文字起こしデータ
        ${transcript}
      `;
      break;
    case 'thinking':
      prompt = `
        あなたは優秀な壁打ち相手です。
        以下の思考の独り言の「文字起こしデータ」を要約し、次のJSON形式で出力してください。

        # 出力形式 (JSON)
        {
          "key_points": ["キーポイントを3つ、箇条書きの配列で"],
          "new_ideas": ["そこから発展する可能性のある新しいアイデアを2つ、箇条書きの配列で"],
          "summary_text": "セッション全体の要約を200字以内で記述"
        }
        
        # 文字起こしデータ
        ${transcript}
      `;
      break;
    case 'presenter':
    default:
      prompt =  `
        あなたは経験豊富なプレゼンテーションのコーチです。
        以下の「文字起こしデータ」と、その内容の「感情分析スコア」を総合的に分析し、次のJSON形式で評価を出力してください。

        # 感情分析スコアについて
        - score: テキスト全体のポジティブ度（-1.0～1.0）。高いほど熱意がありポジティブ。
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
            "clarity": [1-100の整数],
            "passion": [1-100の整数],
            "insightfulness": [1-100の整数],
            "structure": [1-100の整数],
            "confidence": [1-100の整数]
          },
          "highlight": "最も良かった点を200字以内で記述",
          "advice": "改善点を一つだけ200字以内で記述"
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

functions.http('coachApi', async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { type, mode } = req.body;

    if (type === 'realtime-feedback') {
      // リアルタイムフィードバック処理
      const { audioContent, imageContent } = req.body;
      const transcript = await transcribeAudio(audioContent);
      const feedback = await getGeminiVisionFeedback(transcript, imageContent, mode);
      res.status(200).send({ transcript, feedback });

    } else if (type === 'summary-report') {
      // サマリーレポート処理
      const { transcript } = req.body;
      const sentiment = await analyzeTextSentiment(transcript);
      const summary = await getGeminiSummary(transcript, sentiment, mode);
      res.status(200).send(summary);
      
    } else {
      res.status(400).send('Invalid request type');
    }
  });
});

// Speech-to-Text関数
async function transcribeAudio(audioContent) {
  try {
    const request = {
      audio: {
        content: audioContent,
      },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'ja-JP',
        model: 'latest_long',
      },
    };
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    console.log(`Speech-to-Text書き起こし: ${transcription}`);
    return transcription;
  } catch (error) {
    console.error('Speech-to-Text APIエラー:', error);
    return null;
  }
}

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
