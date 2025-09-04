// functions/index.js
const functions = require('@google-cloud/functions-framework');
const cors = require('cors')({origin: true});

// Google Cloudクライアントライブラリ
const { SpeechClient } = require('@google-cloud/speech').v1; // `.v1` を追記
const { LanguageServiceClient } = require('@google-cloud/language');
const { ImageAnnotatorClient } = require('@google-cloud/vision');

// Gemini APIキーを環境変数から取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AI_MODEL = 'gemini-2.5-flash-001';

// 認証情報を使ってクライアントを初期化
const speechClient = new SpeechClient();
const languageClient = new LanguageServiceClient();
const visionClient = new ImageAnnotatorClient();

// Speech-to-Textの秒・ナノ秒を秒（小数）に変換するヘルパー関数
function convertTimeToSeconds(time) {
  if (!time) return 0;
  const seconds = time.seconds ? parseInt(time.seconds) : 0;
  const nanos = time.nanos ? time.nanos / 1e9 : 0;
  return seconds + nanos;
}

// Speech-to-Textの詳細な応答結果を分析するメイン関数
function analyzeTranscriptionResults(results) {
  if (!results || results.length === 0) {
    return null;
  }

  let fullTranscript = '';
  const allWords = [];
  results.forEach(result => {
    if (result.alternatives && result.alternatives.length > 0) {
      fullTranscript += result.alternatives[0].transcript;
      result.alternatives[0].words.forEach(wordInfo => {
        allWords.push(wordInfo);
      });
    }
  });

  if (allWords.length === 0) {
    return { fullTranscript, duration: 0, speakingRate: 0, longPauseCount: 0, fillerWordCount: 0 };
  }

  // 1. 合計発話時間の計算
  const startTime = convertTimeToSeconds(allWords[0].startTime);
  const endTime = convertTimeToSeconds(allWords[allWords.length - 1].endTime);
  const duration = endTime - startTime;

  // 2. 平均話速の計算 (文字/分)
  const speakingRate = duration > 0 ? Math.round((fullTranscript.length / duration) * 60) : 0;

  // 3. 2秒以上の「間」の回数をカウント
  let longPauseCount = 0;
  for (let i = 0; i < allWords.length - 1; i++) {
    const currentWordEnd = convertTimeToSeconds(allWords[i].endTime);
    const nextWordStart = convertTimeToSeconds(allWords[i + 1].startTime);
    if (nextWordStart - currentWordEnd >= 2.0) {
      longPauseCount++;
    }
  }

  // 4. フィラーワードの回数をカウント
  const fillerWords = ["あの", "えー", "えーっと", "まあ", "なんか", "こう"];
  let fillerWordCount = 0;
  allWords.forEach(wordInfo => {
    if (fillerWords.includes(wordInfo.word)) {
      fillerWordCount++;
    }
  });

  return {
    fullTranscript,
    duration,
    speakingRate,
    longPauseCount,
    fillerWordCount
  };
}

// Gemini Vision関数 (リアルタイムフィードバック用)
async function getGeminiVisionFeedback(text, image, mode, history, facialFeedback, persona) {
  if (!text) return null;

  // ▼▼▼ 表情分析の結果をプロンプトに含めるための準備 ▼▼▼
  const facialPromptPart = facialFeedback 
    ? `また、話者の表情は「${facialFeedback}」と分析されています。` 
    : '';

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
          ${facialPromptPart}
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
      prompt = `あなたは辛口のYouTubeプロデューサーです。この画面と発話者の「${text}」という発言内容を踏まえ、視聴者が面白がるような、ユーモアのある短いツッコミを一つ生成してください。${facialPromptPart}`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
    case 'thinking':
      prompt = `あなたは優秀な聞き手です。発話者の「${text}」という発言内容を肯定的に受け止め、「なるほど」「面白いですね」といった短い相槌か、思考を促すための「それは具体的には？」のような短い質問を一つ生成してください。${facialPromptPart}`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
    case 'presenter':
    default:
      let personaPromptPart = '冷静なプレゼンの聴衆';
      if (persona && persona.trim() !== '') {
        personaPromptPart = persona.trim();
      }

      prompt = `あなたは${personaPromptPart}です。このスライド画像と、発表者の「${text}」という発言内容を踏まえ、160文字以内でコメントか質問を生成してください。${facialPromptPart}`;
      requestBody = {
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]}]
      };
      break;
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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
async function getGeminiSummary(combinedResults, sentiment, mode, persona) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

  let prompt;
  switch (mode) {
    case 'creator':
      let creatorPersonaPromptPart = '敏腕YouTubeプロデューサー';
      if (persona && persona.trim() !== '') {
        creatorPersonaPromptPart = persona.trim();
      }
      prompt = `
        あなたは${creatorPersonaPromptPart}です。
        以下の「分析データ」と「文字起こしデータ」を総合的に分析し、評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述
        - 必ず「出力形式」のJSON形式にのみ従ってください。

        # 分析データ
        - 平均話速: ${Math.round(combinedResults.speakingRate)} 文字/分
        - 2秒以上の間の回数: ${combinedResults.longPauseCount} 回
        - フィラーワードの回数: ${combinedResults.fillerWordCount} 回
        - 感情分析スコア: ${JSON.stringify(sentiment)}

        # 評価基準
        - 上記の「分析データ」を最重要の客観的指標として扱い、評価スコアを決定してください。
        - フックの強さ: 視聴者を惹きつける要素があるか。
        - エンタメ性: 面白さや盛り上がりがあるか。
        - ペーシング: 話のテンポや間の使い方。
        - キラーフレーズ: 印象的な言葉やフレーズがあるか。
        - 安全性リスク: 不適切な表現や炎上リスクがないか。

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
        ${combinedResults.fullTranscript}
      `;
      break;
    case 'thinking':
      let thinkingPersonaPromptPart = '優秀な壁打ち相手';
      if (persona && persona.trim() !== '') {
        thinkingPersonaPromptPart = persona.trim();
      }
      prompt = `
        あなたは${thinkingPersonaPromptPart}です。
        以下の思考の独り言の「文字起こしデータ」を要約し、必ず以下「出力形式」のJSON形式にのみ従って出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
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
        ${combinedResults.fullTranscript}
      `;
      break;
    case 'presenter':
    default:
      let personaPromptPart = '経験豊富なプレゼンテーションのコーチ';
      if (persona && persona.trim() !== '') {
        personaPromptPart = persona.trim();
      }

      prompt =  `
        あなたは${personaPromptPart}です。
        以下の「分析データ」と「文字起こしデータ」を総合的に分析し、評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述
        - 必ず「出力形式」のJSON形式にのみ従ってください。

        # 分析データ
        - 平均話速: ${Math.round(combinedResults.speakingRate)} 文字/分
        - 2秒以上の間の回数: ${combinedResults.longPauseCount} 回
        - フィラーワードの回数: ${combinedResults.fillerWordCount} 回
        - 感情分析スコア: ${JSON.stringify(sentiment)}

        # 評価基準
        - 上記の「分析データ」を最重要の客観的指標として扱い、評価スコアを決定してください。
        - 明朗さ: 「フィラーワードの回数」が少ないほど高評価になります。
        - 情熱度: 「感情分析スコア」を最重視して評価してください。
        - 示唆度: 内容に深みや有益な情報があるか。
        - 構成力: 「2秒以上の間の回数」が適切に使われているかを評価してください。
        - 自信: 「平均話速」が適切（早すぎず、遅すぎない）かを評価してください。

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
        ${combinedResults.fullTranscript}
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
        const geminiResult = JSON.parse(match[0]);

        // ▼▼▼ Geminiの結果と、計算済みの分析データを合体させる ▼▼▼
        const finalSummary = {
          scores: geminiResult.scores,
          highlight: geminiResult.highlight,
          advice: geminiResult.advice,
          analysis: { // analysisオブジェクトをここで追加
            speaking_rate: Math.round(combinedResults.speakingRate),
            long_pause_count: combinedResults.longPauseCount,
            filler_words_count: combinedResults.fillerWordCount
          }
        };
        return finalSummary;
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

    const { type, mode, history, persona } = req.body;

    if (type === 'realtime-feedback') {
      // リアルタイムフィードバック処理
      const { audioContent, imageContent, videoFrameContent } = req.body;

      // ▼▼▼ 音声文字起こしと表情分析を並行して実行 ▼▼▼
      const [analysisData, facialFeedback] = await Promise.all([
        transcribeAudio(audioContent),
        analyzeVideoFrame(videoFrameContent)
      ]);

      const transcript = analysisData ? analysisData.fullTranscript : null;
      const feedback = await getGeminiVisionFeedback(transcript, imageContent, mode, history || [], facialFeedback, persona);
      res.status(200).send({ transcript, feedback, analysisData });

    } else if (type === 'summary-report') {
      // サマリーレポート処理
      const { analysisResults } = req.body;

      // ▼▼▼ チャンクごとの分析結果を一つに統合する ▼▼▼
      const combinedResults = {
        fullTranscript: analysisResults.map(r => r.fullTranscript).join(' '),
        duration: analysisResults.reduce((sum, r) => sum + r.duration, 0),
        speakingRate: analysisResults.reduce((sum, r) => sum + r.speakingRate * r.duration, 0) / analysisResults.reduce((sum, r) => sum + r.duration, 0), // 加重平均
        longPauseCount: analysisResults.reduce((sum, r) => sum + r.longPauseCount, 0),
        fillerWordCount: analysisResults.reduce((sum, r) => sum + r.fillerWordCount, 0),
      };

      // speakingRateがNaNになるのを防ぐ
      if (isNaN(combinedResults.speakingRate)) {
        combinedResults.speakingRate = 0;
      }

      const sentiment = await analyzeTextSentiment(combinedResults.fullTranscript);
      const summary = await getGeminiSummary(combinedResults, sentiment, mode, persona);

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
        enableWordTimeOffsets: true, // 単語の開始・終了時間を取得
      },
    };
    const [response] = await speechClient.recognize(request);
    // response には文字起こし結果とタイムスタンプの両方が含まれる
    console.log("Speech-to-Text 詳細応答:", JSON.stringify(response, null, 2));

    const analysisData = analyzeTranscriptionResults(response.results);
    console.log("発話分析データ:", analysisData);

    return analysisData;
  } catch (error) {
    console.error('Speech-to-Text APIエラー:', error);
    return null;
  }
}

async function analyzeVideoFrame(videoFrameContent) {
  // videoFrameContent がない、または空の場合は何もしない
  if (!videoFrameContent) {
    return null;
  }

  try {
    const request = {
      image: {
        content: videoFrameContent,
      },
      features: [{ type: 'FACE_DETECTION' }],
    };

    const [result] = await visionClient.annotateImage(request);
    const faces = result.faceAnnotations;

    if (faces && faces.length > 0) {
      const face = faces[0]; // 最初の顔を対象とする
      const likelihoods = [
        'UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'
      ];

      // 喜びの感情が「ありそう(LIKELY)」以上の場合にフィードバックを生成
      if (likelihoods.indexOf(face.joyLikelihood) >= 4) {
        return "笑顔、あるいは喜びの表情";
      }
      // 驚きの感情が「ありそう(LIKELY)」以上の場合
      if (likelihoods.indexOf(face.surpriseLikelihood) >= 4) {
        return "驚いている表情";
      }
      // 悲しみの感情が「ありそう(LIKELY)」以上の場合
      if (likelihoods.indexOf(face.sorrowLikelihood) >= 4) {
        return "悲しそう、あるいは心配そうな表情";
      }
      
      // 特に強い感情がなければ、ニュートラルなフィードバック
      return "落ち着いた表情です";
    }
    return "表情は検出されませんでした";
  } catch (error) {
    console.error('Vision APIエラー:', error);
    return "表情の解析中にエラーが発生しました";
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
