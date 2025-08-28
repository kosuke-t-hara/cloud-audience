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
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) { // エラーレスポンスをハンドリング
      console.error(`API Error: ${response.status} ${response.statusText}`, await response.json());
      return null;
    }

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
        以下の「文字起こしデータ」と「感情分析スコア」を分析し、必ず以下「出力形式」のJSON形式にのみ従って評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述

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
        以下の思考の独り言の「文字起こしデータ」を要約し、必ず以下「出力形式」のJSON形式にのみ従って出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - key_points: キーポイントを3つ、箇条書きの配列で
        - new_ideas: そこから発展する可能性のある新しいアイデアを3つ、箇条書きの配列で
        - summary_text: セッション全体の要約を、美しい比喩を用いながら800字以内で記述

        # 出力形式 (JSON)
        {
          "key_points": ["<string>"],
          "new_ideas": ["<string>"],
          "summary_text": "<string>"
        }
        
        # 文字起こしデータ
        ${transcript}
      `;
      break;
    case 'presenter':
    default:
      prompt =  `
        あなたは経験豊富なプレゼンテーションのコーチです。
        以下の「文字起こしデータ」と、その内容の「感情分析スコア」を総合的に分析し、
        必ず以下「出力形式」のJSON形式にのみ従って評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述

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
      console.log("Gemini Summary API応答:", jsonString);

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

    const { type, mode, history } = req.body;

    if (type === 'realtime-feedback') {
      // リアルタイムフィードバック処理
      const { audioContent, imageContent } = req.body;
      const transcript = await transcribeAudio(audioContent);
      const feedback = await getGeminiVisionFeedback(transcript, imageContent, mode, history || []);
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
