// background.js
let helperWindowId = null;
let isRecording = false;
let fullTranscript = ""; // 全文を保存する変数

// APIキーの設定 (あとで環境変数に変更予定)
const SPEECH_API_KEY = 'AIzaSyClUPxhp-V4TdYrjkq0-N6f7B7UenjS5Qw';
const GEMINI_API_KEY = 'AIzaSyBXYC5wZeheBszWRs6-kWn1jbqOqRLZyGY';

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle_recording") {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
});

function startRecording() {
  isRecording = true;
  fullTranscript = ""; // 練習開始時にリセット
  chrome.windows.create({
    url: 'mic_helper.html', type: 'popup', width: 250, height: 150,
  }, (win) => {
    helperWindowId = win.id;
  });
}

function stopRecording() {
  isRecording = false;
  if (helperWindowId) {
    chrome.runtime.sendMessage({ type: 'stop_recording' });
    helperWindowId = null;
  }
  // 練習終了時にサマリー生成関数を呼び出す
  generateSummary();
}

// ウィンドウが閉じられたことを検知
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === helperWindowId) {
    isRecording = false;
    helperWindowId = null;
  }
});

// mic_helper.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.type === 'audio_chunk') {
    handleAudioChunk(request.data);
  } else if (request.type === 'mic_error') {
    console.error("ヘルパーウィンドウでエラー:", request.error);
    stopRecording();
  }
});

async function handleAudioChunk(audioContent) {
  try {
    const transcript = await sendToSpeechAPI(audioContent);
    if (transcript) {
      fullTranscript += transcript + " "; // 文字起こし結果を追記
      const screenshotDataUrl = await captureVisibleTab();
      const base64ImageData = screenshotDataUrl.split(',')[1];
      await sendToGeminiAPI(transcript, base64ImageData);
    }
  } catch (error) {
    console.error("handleAudioChunk内でエラーが発生しました:", error);
  }
}

async function sendToSpeechAPI(audioContent) {
  const API_URL = `https://speech.googleapis.com/v1/speech:recognize?key=${SPEECH_API_KEY}`;
  const requestBody = {
    config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'ja-JP' },
    audio: { content: audioContent },
  };
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    const data = await response.json();
    if (data.results && data.results.length > 0) return data.results[0].alternatives[0].transcript;
  } catch (error) { console.error('Speech API Error:', error); }
  return null;
}

function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(dataUrl);
    });
  });
}

async function sendToGeminiAPI(text, image) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const requestBody = {
    contents: [{ parts: [
      { text: `あなたは親身なプレゼンの聴衆です。このスライド画像と、発表者の「${text}」という発言内容を踏まえ、80文字以内で短いコメントか、ポジティブなリアクションを一つだけ生成してください。` },
      { inline_data: { mime_type: 'image/jpeg', data: image } }
    ]}]
  };
  try {
    const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
    
    const data = await response.json();

    // ▼▼▼ ここからが重要な修正 ▼▼▼
    // data.candidatesが存在し、かつ配列が空でないことを確認する
    if (data.candidates && data.candidates.length > 0) {
      const feedback = data.candidates[0].content.parts[0].text;

      // ▼▼▼ ここから変更 ▼▼▼
      console.log(`これからcontent.jsへフィードバック「${feedback}」を送信します。`);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'show-feedback', data: feedback }, (response) => {
            // メッセージが届いたかどうかの確認
            if (chrome.runtime.lastError) {
              console.error('メッセージ送信エラー:', chrome.runtime.lastError.message);
            } else {
              console.log('content.jsからの応答:', response?.status);
            }
        });
        } else {
          console.error("メッセージ送信先のタブが見つかりません。");
        }
      });
      // ▲▲▲ ここまで変更 ▲▲▲
    } else {
      // 応答が生成されなかった場合のログ
      console.warn('Geminiは応答を生成しませんでした。レスポンス:', data);
    }
    // ▲▲▲ ここまで修正 ▲▲▲

  } catch (error) { console.error('Gemini API Error:', error); }
}

// 5. ▼▼▼ サマリー生成用の関数を丸ごと追加 ▼▼▼
async function generateSummary() {
  if (fullTranscript.trim().length === 0) {
    console.log("発話がなかったため、サマリーを生成しませんでした。");
    return;
  }

  console.log("サマリーを生成します。全文:", fullTranscript);
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = `
    あなたは経験豊富なプレゼンテーションのコーチです。
    以下のプレゼンテーションの文字起こしデータを分析し、次のJSON形式で評価を出力してください。

    # 評価基準
    - 明朗さ: 話し方が明確で論理的か。
    - 情熱度: 声の抑揚や熱意が感じられるか。
    - 示唆度: 内容に深みや有益な情報があるか。
    - 構成力: 全体の流れがスムーズか。
    - 自信: よどみなく堂々と話せているか。

    # 出力形式 (JSON)
    {
      "scores": {
        "clarity": [1-5の整数],
        "passion": [1-5の整数],
        "insightfulness": [1-5の整数],
        "structure": [1-5の整数],
        "confidence": [1-5の整数]
      },
      "highlight": "最も良かった点を80字以内で記述",
      "advice": "改善点を一つだけ80字以内で記述"
    }

    # 文字起こしデータ
    ${fullTranscript}
  `;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    // まず、レスポンスをテキストとして取得する
    const responseText = await response.text();
    console.log("Gemini APIからの生の応答:", responseText); // これでHTMLの内容が確認できる

    // テキストをJSONとして解析する
    const data = JSON.parse(responseText);

    if (!data.candidates || data.candidates.length === 0) {
      // 応答がない場合は、ここで処理を中断し、APIからの生のエラー内容を確認する
      console.error("Gemini APIから有効な候補が返されませんでした。APIの応答:", data);
      return; // ここで処理を終了
    }
  
    const rawText = data.candidates[0].content.parts[0].text;
    let jsonString = rawText; // 元のテキストを保持

    // 正規表現を使って、`{` で始まり `}` で終わるJSON部分だけを抜き出す
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      jsonString = match[0];
    }

    // 文字列内のすべての改行コードを削除する
    // jsonString = jsonString.replace(/\n/g, '');
    // エスケープ用のバックスラッシュを削除
    // jsonString = jsonString.replace(/\\"/g, '"');

    try {
      const summaryData = JSON.parse(jsonString);

      // 結果を新しいタブで開く
      chrome.tabs.create({ url: 'summary.html' }, (tab) => {
        // 新しいタブにデータを送る
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'show_summary', data: summaryData });
        }, 500); // タブの読み込みを待つ
      });
    } catch(error) {
      console.error("JSONの解析に失敗しました。整形後の文字列:", jsonString, "エラー:", error);
    }

  } catch (error) {
    console.error('サマリーの生成に失敗しました:', error);
  }
}
