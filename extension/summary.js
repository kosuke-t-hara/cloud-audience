// --- ローディングメッセージ関連 ---
const loadingMessages = [
  // オリジナル
  "魔法の呪文を唱えています... ✨",
  "AIが腕まくりをしました...",
  "思考の海に深く潜っています...",
  "あなたの言葉からダイヤモンドの原石を発掘中...",
  "最高のフィードバックをコンパイル中 (バグが出ませんように)",
  "拍手喝采の瞬間をシミュレーションしています...",
  "宇宙の真理とあなたのスピーチを照合中...",
  "もう少しです...たぶん！",
  // 追加分
  "フィードバックを最適化中... O(log n)で終わらせたい。",
  "ニューラルネットワークにコーヒーを淹れています...",
  "1と0を並べ替えて、素晴らしい洞察を作成中。",
  "あなたのスピーチを分析中。それはバグじゃなくて、特徴です。",
  "ピクセルを磨いています... レポートが輝くように。",
  "アルゴリズムに「喝」を入れています。",
  "シリコンの筋肉をストレッチ中...",
  "あなたの言葉の裏にある宇宙の意図を解読中...",
  "存在意義について少し考えていました。さて、レポート作成に戻ります。",
  "アイデアの星座を結んでいます...",
  "分析のポーションを調合中... 秘密の材料をひとつまみ。",
  "洞察の巻物を読み解いています...",
  "あなたの言葉にエンチャントをかけています...",
  "ちょっと休憩... AIだって一息つきたい。",
  "インスピレーションが湧くのを待っています... 待ちぼうけ。",
  "最高の言葉を選ぶために、辞書と格闘中。",
  "あなたの話術から「いいね！」を探しています。",
  "フィードバックを金箔で飾り付け中...",
  "改善点を分かりやすく翻訳しています...",
  "自分自身とブレインストーミング中です。なかなか良いアイデアが出ます。"
];
let messageInterval = null;

function startLoadingAnimation() {
  const messageElement = document.getElementById('loading-message');
  let lastMessageIndex = -1; // 直前に表示したメッセージのインデックスを保持

  messageInterval = setInterval(() => {
    let newMessageIndex;
    // 同じメッセージが連続しないように、新しいインデックスを生成する
    do {
      newMessageIndex = Math.floor(Math.random() * loadingMessages.length);
    } while (loadingMessages.length > 1 && newMessageIndex === lastMessageIndex);
    
    messageElement.textContent = loadingMessages[newMessageIndex];
    lastMessageIndex = newMessageIndex;
  }, 3000); // 3秒ごとにメッセージを切り替え
}

function stopLoadingAnimation() {
  if (messageInterval) {
    clearInterval(messageInterval);
    messageInterval = null;
  }
}

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
  startLoadingAnimation();
  // サマリーページの準備ができたことをバックグラウンドに通知
  chrome.runtime.sendMessage({ type: 'SUMMARY_PAGE_READY' });
});


// --- チャート関連 ---
let radarChart = null; // チャートインスタンスを保持する変数

// ページが閉じられるときにチャートを破棄
window.addEventListener('beforeunload', () => {
  if (radarChart) {
    radarChart.destroy();
    radarChart = null;
    console.log('Chart instance destroyed on page unload.');
  }
});


// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const loadingContainer = document.getElementById('loading-container');
  const errorContainer = document.getElementById('error-container');
  const summaryContent = document.getElementById('summary-content');

  if (request.type === 'show_summary') {
    stopLoadingAnimation();
    // ローディングを非表示にし、サマリーを表示
    loadingContainer.style.display = 'none';
    summaryContent.style.display = 'block';

    const mode = request.mode;
    const data = request.data;

    // ★★★ 追加: 練習時間を表示 ★★★
    if (data.totalTime) {
      const minutes = Math.floor(data.totalTime / 60).toString().padStart(2, '0');
      const seconds = (data.totalTime % 60).toString().padStart(2, '0');
      const timeString = `${minutes}:${seconds}`;
      // total-time-value のようなIDを持つ要素に時間を設定することを想定
      const timeElement = document.getElementById('total-time-value');
      if (timeElement) {
        timeElement.textContent = timeString;
      }
    }

    // モードに応じて表示を切り替える
    if (mode === 'presenter' || mode === 'creator') {
      // プレゼンター/クリエイターモードの処理
      document.getElementById('rating-summary').style.display = 'block';
      document.getElementById('totalScoreValue').textContent = data.totalScore;
      
      document.getElementById('highlight').textContent = data.highlight;
      document.getElementById('advice').textContent = data.advice;

      document.getElementById('personaComment').textContent = data.persona_comment;
      
      // レーダーチャートのラベルをモードに応じて変更
      const labels = (mode === 'presenter')
        ? ['明朗さ', '情熱度', '示唆度', '構成力', '自信']
        : ['掴みの強さ', 'エンタメ性', '緩急', 'キラーフレーズ', '安全性'];
      
      const scores = (mode === 'presenter')
        ? [data.scores.clarity, data.scores.passion, data.scores.insightfulness, data.scores.structure, data.scores.confidence]
        : [data.scores.hook_strength, data.scores.entertainment, data.scores.pacing, data.scores.killer_phrase, data.scores.safety_risk];

      if (data.analysis) {
        document.getElementById('speaking-rate').textContent = data.analysis.speaking_rate;
        document.getElementById('filler-words-count').textContent = data.analysis.filler_words_count;
      }

      const ctx = document.getElementById('radarChart').getContext('2d');
      if (radarChart) {
        radarChart.destroy();
      }
      radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [{
            label: 'スコア',
            data: scores,
            backgroundColor: 'rgba(66, 133, 244, 0.2)',
            borderColor: 'rgba(66, 133, 244, 1)',
            borderWidth: 2
          }]
        },
        options: { scales: { r: { beginAtZero: true, max: 100 }}}
      });

      // AIからの質問リストを描画
      if (data.questions && data.questions.length > 0) {
        const questionsList = document.getElementById('questions-list-rating');
        questionsList.innerHTML = ''; // Clear existing
        data.questions.forEach(question => {
          const li = document.createElement('li');
          li.textContent = question;
          questionsList.appendChild(li);
        });
      }

    } else if (mode === 'thinking') {
      // 思考パートナーモードの処理
      document.getElementById('thinking-summary').style.display = 'block';

      document.getElementById('summary-text').textContent = data.summary_text;
      
      const keyPointsList = document.getElementById('key-points-list');
      keyPointsList.innerHTML = ''; // Clear existing
      data.key_points.forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        keyPointsList.appendChild(li);
      });

      const newIdeasList = document.getElementById('new-ideas-list');
      newIdeasList.innerHTML = ''; // Clear existing
      data.new_ideas.forEach(idea => {
        const li = document.createElement('li');
        li.textContent = idea;
        newIdeasList.appendChild(li);
      });

      // AIからの質問リストを描画
      if (data.questions && data.questions.length > 0) {
        const questionsList = document.getElementById('questions-list-thinking');
        questionsList.innerHTML = ''; // Clear existing
        data.questions.forEach(question => {
          const li = document.createElement('li');
          li.textContent = question;
          questionsList.appendChild(li);
        });
      }
    }

    // ★★★ 変更点: アコーディオンロジックを追加 ★★★
    if (data.feedbackHistory && data.feedbackHistory.length > 0) {
      const historyContainer = document.getElementById('feedback-history-container');
      const historyLogContainer = document.getElementById('feedback-history-log');
      const toggleButton = document.getElementById('accordion-toggle-button');
      const contentPanel = document.getElementById('accordion-content-panel');

      // コンテナをクリア
      historyLogContainer.innerHTML = ''; 

      // 履歴データをHTMLに変換して挿入
      data.feedbackHistory.forEach(entry => {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'feedback-entry';

        const userP = document.createElement('p');
        userP.className = 'user-transcript';
        userP.textContent = `あなた: ${entry.transcript}`;

        const aiP = document.createElement('p');
        aiP.className = 'ai-feedback';
        aiP.textContent = `AI: ${entry.feedback}`;

        entryDiv.appendChild(userP);
        entryDiv.appendChild(aiP);
        historyLogContainer.appendChild(entryDiv);
      });

      // 履歴があるので、アコーディオン全体を表示
      historyContainer.style.display = 'block';

      // クリックイベントを設定
      toggleButton.addEventListener('click', () => {
        toggleButton.classList.toggle('active');
        if (contentPanel.style.display === 'block') {
          contentPanel.style.display = 'none';
          toggleButton.textContent = '履歴を開く';
        } else {
          contentPanel.style.display = 'block';
          toggleButton.textContent = '履歴を閉じる';
        }
      });
    }

  } else if (request.type === 'show_summary_error') {
    stopLoadingAnimation();
    // ローディングを非表示にし、エラーを表示
    loadingContainer.style.display = 'none';
    errorContainer.style.display = 'block';
    
    let errorMessage = `<h2>サマリーの生成に失敗しました</h2><p>${request.error}</p>`;
    if (request.details) {
      errorMessage += `<p>詳細: ${request.details}</p>`;
    }
    errorContainer.innerHTML = errorMessage;
  }

  // 応答を返す
  sendResponse({ status: "OK" });

  // background.jsにサマリー表示完了を通知
  chrome.runtime.sendMessage({ type: 'SUMMARY_DISPLAY_COMPLETE' });

  return true; // 非同期処理を示すためにtrueを返す
});