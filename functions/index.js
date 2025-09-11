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
  const fillerWords = [
    "あの", "あー", "えー", "えーっと", "えっと", "えーと", 
    "まあ", "なんか", "こう", "その", "ええと", "んと"
  ];
  let fillerWordCount = 0;
  allWords.forEach(wordInfo => {
    // wordInfo.word に含まれるフィラーワードをチェック (例：「あのー」も「あの」としてカウント)
    if (fillerWords.some(filler => wordInfo.word.startsWith(filler))) {
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
async function getGeminiVisionFeedback(text, image, mode, history, facialFeedback, persona, conversationSummary) {
  if (!text) return null;

  const facialPromptPart = facialFeedback 
    ? `話者の表情は「${facialFeedback}」と分析されています。` 
    : '表情は分析されていません。';

  let personaPromptPart = '冷静なプレゼンの聴衆';
  if (persona && persona.trim() !== '') {
    personaPromptPart = persona.trim();
  }

  const prompt = `
    あなたは${personaPromptPart}です。

    # 状況
    これまでの会話の要約: "${conversationSummary || 'まだ会話は始まっていません。'}"
    現在のスクリーンショット: (画像参照)
    話者の最新の発言: "${text}"
    話者の表情の分析結果: "${facialPromptPart}"

    # あなたのタスク
    1. 上記の「状況」をすべて踏まえ、これまでの文脈に沿った、連続性のある短いフィードバック（コメントか質問）を生成してください。
    2. これまでの要約と今回の発言内容を統合し、次回のフィードバックの文脈として使うための「新しい会話の要約」を300文字以内で生成してください。

    # 出力形式 (必ずこのJSON形式で出力してください)
    {
      "feedback": "<ここにタスク1で生成したフィードバックを記述>",
      "newSummary": "<ここにタスク2で生成した新しい要約を記述>"
    }
  `;

  const requestBody = {
    contents: [{ parts: [
      { text: prompt }
      // ★★★ 修正点: imageが存在する場合のみ、inline_dataを追加 ★★★
    ]}],
    generationConfig: {
      responseMimeType: "application/json",
    }
  };

  if (image) {
    requestBody.contents[0].parts.push({
      inline_data: { mime_type: 'image/jpeg', data: image }
    });
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error(`API Error: ${response.status} ${response.statusText}`, await response.json());
      return { feedback: 'エラーが発生しました', newSummary: conversationSummary };
    }

    const data = await response.json();
    if (data.candidates && data.candidates.length > 0) {
      const jsonString = data.candidates[0].content.parts[0].text;
      return JSON.parse(jsonString);
    }
  } catch (error) {
    console.error('Gemini Vision APIエラー:', error);
  }
  return { feedback: '解析中にエラーが発生しました。', newSummary: conversationSummary };
}

// Gemini Summary関数 (サマリーレポート用)
async function getGeminiSummary(combinedResults, sentiment, mode, persona, conversationSummary) {
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
        以下の「分析データ」「リアルタイム対話の要約」「文字起こしデータ」を総合的に分析し、評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述
        - 最後に、あなたは「${creatorPersonaPromptPart}」の役割に完全になりきり、発話全体への総評を persona_comment として800字以内で記述してください。
        - さらに、この動画の視聴者として、内容を深掘りするための鋭い質問を3つ生成し、'questions'キーに配列として含めてください。
        - 必ず「出力形式」のJSON形式にのみ従ってください。

        # 分析データ
        - 平均話速: ${Math.round(combinedResults.speakingRate)} 文字/分
        - 2秒以上の間の回数: ${combinedResults.longPauseCount} 回
        - フィラーワードの回数: ${combinedResults.fillerWordCount} 回
        - 感情分析スコア: ${JSON.stringify(sentiment)}

        # リアルタイム対話の要約
        ${conversationSummary || 'リアルタイムの対話はありませんでした。'}

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
          "advice": "<string>",
          "persona_comment": "<string>",
          "questions": [
            "<string: 質問1>",
            "<string: 質問2>",
            "<string: 質問3>"
          ]
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
        以下の思考の独り言の「文字起こしデータ」と「対話の要約」を要約し、必ず以下「出力形式」のJSON形式にのみ従って出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - key_points: キーポイントを3つ、箇条書きの配列で
        - new_ideas: そこから発展する可能性のある新しいアイデアを3つ、箇条書きの配列で
        - summary_text: セッション全体の要約を、美しい比喩を用いながら800字以内で記述
        - さらに、思考を深めるための鋭い問いを3つ生成し、'questions'キーに配列として含めてください。

        # リアルタイム対話の要約
        ${conversationSummary || 'リアルタイムの対話はありませんでした。'}

        # 出力形式 (JSON)
        {
          "key_points": ["<string>"],
          "new_ideas": ["<string>"],
          "summary_text": "<string>",
          "questions": [
            "<string: 質問1>",
            "<string: 質問2>",
            "<string: 質問3>"
          ]
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
        以下の「分析データ」「リアルタイム対話の要約」「文字起こしデータ」を総合的に分析し、評価を出力してください。

        # ルール
        - 全てのキーと文字列の値は、必ずダブルクォーテーション("")で囲んでください。
        - 評価値は1から100の整数で表現してください。
        - highlight: 最も良かった点を含めて800字以内で記述
        - advice: 改善点を800字以内で記述
        - 最後に、あなたは「${personaPromptPart}」という設定に完全になりきり、発話全体への総評を persona_comment として800字以内で記述してください。
        - さらに、このプレゼンテーションのペルソナあるいは聴衆として、内容を深掘りするための鋭い質問を3つ生成し、'questions'キーに配列として含めてください。
        - 必ず「出力形式」のJSON形式にのみ従ってください。

        # 分析データ
        - 平均話速: ${Math.round(combinedResults.speakingRate)} 文字/分
        - 2秒以上の間の回数: ${combinedResults.longPauseCount} 回
        - フィラーワードの回数: ${combinedResults.fillerWordCount} 回
        - 感情分析スコア: ${JSON.stringify(sentiment)}

        # リアルタイム対話の要約
        ${conversationSummary || 'リアルタイムの対話はありませんでした。'}

        # 評価基準
        - 上記の「分析データ」を最重要の客観的指標として扱い、評価スコアを決定してください。
        - 明朗さ: 話し方が明確で論理的か。「フィラーワードの回数」を厳格に評価してください。例えば、5回以上でスコアは70点以下、10回以上でスコアは40点以下のように、回数に応じて明確にスコアを下げてください。
        - 情熱度: 「感情分析スコア」を最重視して評価してください。
        - 示唆度: 内容に深みや有益な情報があるかで評価してください。
        - 構成力: 「2秒以上の間の回数」が適切に使われているかを含めて評価してください。
        - 自信: 「平均話速」が適切（早すぎず、遅すぎない）かを含めて評価してください。

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
          "advice": "<string>",
          "persona_comment": "<string>",
          "questions": [
            "<string: 質問1>",
            "<string: 質問2>",
            "<string: 質問3>"
          ]
        }

        # 文字起こしデータ
        ${combinedResults.fullTranscript}
      `;
  }

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    }
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API Error: ${response.status} ${response.statusText}`, errorText);
      return { success: false, error: `API request failed with status ${response.status}` };
    }

    const data = await response.json();

    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content.parts.length > 0) {
      const jsonString = data.candidates[0].content.parts[0].text;
      console.log("Gemini Summary API応答:", jsonString);

      try {
        const geminiResult = JSON.parse(jsonString);

        let totalScore = 0;
        if (geminiResult.scores && Object.keys(geminiResult.scores).length > 0) {
          totalScore = Object.values(geminiResult.scores).reduce((sum, score) => sum + score, 0);
        }

        const finalSummary = {
          scores: geminiResult.scores,
          highlight: geminiResult.highlight,
          advice: geminiResult.advice,
          analysis: {
            speaking_rate: Math.round(combinedResults.speakingRate),
            long_pause_count: combinedResults.longPauseCount,
            filler_words_count: combinedResults.fillerWordCount
          },
          totalScore: totalScore,
          persona_comment: geminiResult.persona_comment,
          questions: geminiResult.questions // ★ 追加
        };
        return { success: true, data: finalSummary };
      } catch (parseError) {
        console.error('Gemini Summary APIのJSONパースエラー:', parseError);
        console.error('パースに失敗した文字列:', jsonString);
        return { success: false, error: 'Failed to parse summary JSON.', details: parseError.message };
      }
    } else {
      console.error('Gemini Summary APIからの応答が不正です:', JSON.stringify(data, null, 2));
      return { success: false, error: 'Invalid response structure from summary API.' };
    }
  } catch (error) {
    console.error('Gemini Summary APIの呼び出しエラー:', error);
    return { success: false, error: 'Failed to call summary API.', details: error.message };
  }
}

functions.http('coachApi', async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { type, mode, history, persona } = req.body;

    if (type === 'realtime-feedback') {
      const { audioContent, imageContent, videoFrameContent, conversationSummary } = req.body;

      const [analysisData, facialFeedback] = await Promise.all([
        transcribeAudio(audioContent),
        analyzeVideoFrame(videoFrameContent)
      ]);

      const transcript = analysisData ? analysisData.fullTranscript : null;
      const geminiResult = await getGeminiVisionFeedback(transcript, imageContent, mode, history || [], facialFeedback, persona, conversationSummary);

      res.status(200).send({ 
        transcript, 
        feedback: geminiResult ? geminiResult.feedback : null, 
        analysisData,
        newConversationSummary: geminiResult ? geminiResult.newSummary : conversationSummary
      });

    } else if (type === 'summary-report') {
      const { analysisResults, conversationSummary, totalTime } = req.body; // ★ totalTime を受け取る

      const combinedResults = {
        fullTranscript: analysisResults.map(r => r.fullTranscript).join(' '),
        duration: analysisResults.reduce((sum, r) => sum + r.duration, 0),
        speakingRate: analysisResults.reduce((sum, r) => sum + r.speakingRate * r.duration, 0) / analysisResults.reduce((sum, r) => sum + r.duration, 0),
        longPauseCount: analysisResults.reduce((sum, r) => sum + r.longPauseCount, 0),
        fillerWordCount: analysisResults.reduce((sum, r) => sum + r.fillerWordCount, 0),
      };

      if (isNaN(combinedResults.speakingRate)) {
        combinedResults.speakingRate = 0;
      }

      const sentiment = await analyzeTextSentiment(combinedResults.fullTranscript);
      const summaryResult = await getGeminiSummary(combinedResults, sentiment, mode, persona, conversationSummary);

      if (summaryResult.success) {
        // ★ レスポンスに totalTime を追加
        res.status(200).send({ ...summaryResult.data, totalTime: totalTime });
      } else {
        res.status(500).send({ error: "サマリーの生成に失敗しました。", details: summaryResult.error, rawDetails: summaryResult.details });
      }
    } else {
      res.status(400).send('Invalid request type');
    }
  });
});

// Speech-to-Text関数
async function transcribeAudio(audioContent) {
  try {
    // ★★★ 修正点: Base64デコード処理を追加 ★★★
    const audioBytes = Buffer.from(audioContent, 'base64');

    const request = {
      audio: {
        content: audioBytes, // デコードしたデータを渡す
      },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'ja-JP',
        model: 'latest_long',
        enableWordTimeOffsets: true,
      },
    };
    const [response] = await speechClient.recognize(request);
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
      const face = faces[0];
      const likelihoods = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
      if (likelihoods.indexOf(face.joyLikelihood) >= 4) return "笑顔、あるいは喜びの表情";
      if (likelihoods.indexOf(face.surpriseLikelihood) >= 4) return "驚いている表情";
      if (likelihoods.indexOf(face.sorrowLikelihood) >= 4) return "悲しそう、あるいは心配そうな表情";
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