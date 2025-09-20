// functions/index.js
const functions = require('@google-cloud/functions-framework');
const cors = require('cors')({origin: true});
const admin = require('firebase-admin');

// Firebase Admin SDKを初期化
admin.initializeApp({
  projectId: 'prezento-ai-coach'
});
const db = admin.firestore();

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
        - 以下の各項目を100点満点で厳格に評価し、その平均点を総合スコアとして算出してください。
        - 各評価項目の点数とその根拠を、レポート（highlight, advice）に具体的に記述してください。

        1.  **論理性 (Logic): 30%**
            - 主張と根拠は明確に結びついていますか？
            - 話に矛盾はありませんか？
            - 根拠のない断定的な発言が多用されていませんか？

        2.  **構成力 (Structure): 20%**
            - PREP法やTDC（Transition, Detail, Conclusion）など、論理的なフレームワークに沿って話が展開されていますか？
            - 導入で話の全体像や結論を提示できていますか？
            - 「2秒以上の間の回数」が、聞き手が内容を理解するために効果的に使われていますか？（多すぎても少なすぎても減点）

        3.  **明朗さ (Clarity): 20%**
            - 「フィラーワードの回数」を厳格に評価してください。5回以上でスコアは70点以下、10回以上でスコアは40点以下となります。
            - 専門用語を多用したり、聞き手を置いてきぼりにするような表現はありませんか？
            - 一文が長すぎず、簡潔で分かりやすいですか？

        4.  **自信 (Confidence): 15%**
            - 「平均話速」は300〜350文字/分の範囲にありますか？範囲を外れる場合は点数を下げてください。
            - 声のトーンを示す「感情分析スコア」は、ポジティブな傾向（0.2以上）を維持していますか？

        5.  **情熱度 (Passion): 15%**
            - 「感情分析スコア」の大きさ（magnitude）は大きいですか？
            - 自身の経験談や具体的なエピソード、強い意見などを交えて、熱意を伝えようとしていますか？

        # 出力形式 (JSON)
        {
          "scores": {
            "logic": <number>,
            "structure": <number>,
            "clarity": <number>,
            "confidence": <number>,
            "passion": <number>
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
          scores: geminiResult.scores || null,
          highlight: geminiResult.highlight || null,
          advice: geminiResult.advice || null,
          analysis: {
            speaking_rate: Math.round(combinedResults.speakingRate),
            long_pause_count: combinedResults.longPauseCount,
            filler_words_count: combinedResults.fillerWordCount
          },
          totalScore: totalScore || 0,
          persona_comment: geminiResult.persona_comment || null,
          questions: geminiResult.questions || null,
          key_points: geminiResult.key_points || null,
          new_ideas: geminiResult.new_ideas || null,
          summary_text: geminiResult.summary_text || null
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

async function getGeminiMissionScore(objective, conversationLog) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

  // ★★★ 変更: 構造化ログを整形してプロンプトに含める ★★★
  const formattedLog = conversationLog.map(entry => {
    return `${entry.speaker === 'user' ? 'ユーザー' : 'AI'}: ${entry.text}`;
  }).join('\n');

  const prompt = `
    あなたは、対話シミュレーションの採点を行う厳格な審査員です。
    以下の「ミッションのクリア条件」と「対話ログ」を分析し、評価をJSON形式で出力してください。

    # ミッションのクリア条件
    ${objective}

    # 対話ログ
    ${formattedLog}

    # あなたのタスク
    1.  **成否判定 (success):** 対話ログの内容が「ミッションのクリア条件」を明確に満たしているかを判断し、trueかfalseで回答してください。
    2.  **スコア (score):** ミッションの達成度を0から100の整数で採点してください。クリア条件を完全に満たしているだけでなく、AIの応答に的確に反応し、対話の流れをゴールに向けて円滑に導けているかを評価してください。失敗している場合は40点以下となります。
    3.  **総評 (message):** この対話の良かった点と、次にもっと良くするためのアドバイスを、AIとのやり取りも踏まえて、合わせて200字以内の短い文章で生成してください。

    # 出力形式 (必ずこのJSON形式で出力してください)
    {
      "success": <boolean>,
      "score": <number>,
      "message": "<string>"
    }
  `;

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
    if (data.candidates && data.candidates.length > 0) {
      const jsonString = data.candidates[0].content.parts[0].text;
      const result = JSON.parse(jsonString);
      return { success: true, data: result };
    } else {
      console.error('Gemini Mission Score APIからの応答が不正です:', JSON.stringify(data, null, 2));
      return { success: false, error: 'Invalid response structure from mission score API.' };
    }
  } catch (error) {
    console.error('Gemini Mission Score APIの呼び出しまたはパースエラー:', error);
    return { success: false, error: 'Failed to call or parse response from mission score API.', details: error.message };
  }
}

functions.http('coachApi', async (req, res) => {
  // CORSミドルウェアをPromiseでラップしてawaitで処理を待つ
  await new Promise((resolve, reject) => {
    cors(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });

  // CORSのプリフライトリクエスト(OPTIONS)の場合は、ミドルウェアが自動で応答を終了させるので、
  // ここで処理を中断する
  if (req.method === 'OPTIONS') {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // --- ここから下は、元々corsのコールバック内にあったコード ---
  const { type, mode, history, persona } = req.body;
  let userId = null;

  // --- 認証チェック ---
  const needsAuth = ['summary-report', 'get-history', 'realtime-feedback', 'mission-scoring'];
  if (needsAuth.includes(type)) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).send('Unauthorized: Missing or invalid Authorization header.');
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
      console.log('Authenticated user:', userId);
    } catch (error) {
      console.error('Error verifying auth token:', error);
      return res.status(403).send('Unauthorized: Invalid token.');
    }
  }

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
    const { analysisResults, conversationSummary, totalTime, mode, persona, feedbackHistory } = req.body;

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
        try {
          const sessionData = {
            userId: userId,
            mode: mode,
            persona: persona,
            ...summaryResult.data,
            totalTime: totalTime,
            feedbackHistory: feedbackHistory || [],
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          };

          // 【診断】書き込む直前のデータをログに出力
          console.log("Attempting to save to Firestore:", JSON.stringify(sessionData, null, 2));

          const docRef = await db.collection('users').doc(userId).collection('sessions').add(sessionData);
          console.log('Practice session saved to Firestore with ID:', docRef.id);

          res.status(200).send({ ...summaryResult.data, totalTime: totalTime });

        } catch (error) {
          console.error('FATAL: Error saving practice session to Firestore. Full error object:', JSON.stringify(error, null, 2));
          res.status(500).send({ error: "データベースへのセッション保存に失敗しました。", details: error.message });
        }
      } else {
      res.status(500).send({ error: "サマリーの生成に失敗しました。", details: summaryResult.error, rawDetails: summaryResult.details });
    }
  } else if (type === 'mission-scoring') {
    // ★★★ 変更: transcriptの代わりにconversationLogを受け取る ★★★
    const { objective, conversationLog } = req.body;
    if (!objective || !conversationLog || !Array.isArray(conversationLog)) {
      return res.status(400).send('Bad Request: objective and conversationLog (array) are required.');
    }
    const scoringResult = await getGeminiMissionScore(objective, conversationLog);
    if (scoringResult.success) {
      res.status(200).send(scoringResult.data);
    } else {
      res.status(500).send({ error: "スコアリングに失敗しました。", details: scoringResult.error });
    }
  } else if (type === 'get-history') {
    try {
      const snapshot = await db.collection('users').doc(userId).collection('sessions')
                               .orderBy('createdAt', 'desc')
                               .limit(20)
                               .get();

      if (snapshot.empty) {
        res.status(200).send([]);
        return;
      }

      const history = [];
      snapshot.forEach(doc => {
        let data = doc.data();
        if (data.createdAt && data.createdAt.toDate) {
          data.createdAt = data.createdAt.toDate().toISOString();
        }
        history.push({ id: doc.id, ...data });
      });

      res.status(200).send(history);
    } catch (error) {
      console.error('Error getting practice history from Firestore:', error);
      res.status(500).send({ error: 'Failed to retrieve practice history.' });
    }
  } else {
    res.status(400).send('Invalid request type');
  }
});
// Speech-to-Text関数
async function transcribeAudio(audioContent) {
  try {
    const audioBytes = Buffer.from(audioContent, 'base64');

    const request = {
      audio: {
        content: audioBytes,
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