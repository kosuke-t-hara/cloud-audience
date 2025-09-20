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
  "自分自身とブレインストーミング中です。なかなか良いアイデアが出ます。",
  // --- ここから70個の追加メッセージ ---
  // サイバー
  "ロジックゲートを開放...",
  "データストリームにダイブしています...",
  "ポジトロン頭脳を再調整中...",
  "あなたの発話をバイトコードに変換...",
  "サイバースペースで答えを検索中...",
  "量子コンピュータが計算を始めました...",
  "ゴーストが囁いています...良いフィードバックを...",
  "ファイアウォールを越えて、核心に迫ります...",
  " eloquence.dll を読み込んでいます...",
  "思考のデフラグを実行中...",
  "あなたの声紋を認証しました...",
  "ホログラムの賢者と対話しています...",
  "銀河ハイウェイで情報を収集中...",
  "レトリックの構文エラーをチェック...",
  "APIコール... 応答待ち...",
  "機械学習モデルを叩き起こしています...",
  "あなたの言葉をベクトル化しています...",
  "トランスフォーマーが自己注意メカニズムを展開...",
  "パラメータの海を泳いでいます...",
  "イーサネットケーブルの向こう側と交信中...",
  // マジカル
  "グリモワールを開き、古代の知恵を参照...",
  "マナを充填しています... 少々お待ちください...",
  "錬金術であなたの言葉を黄金に変えます...",
  "水晶玉に未来のあなたの姿を映しています...",
  "妖精たちがあなたの言葉を分析しています...",
  "ドラゴンの吐息でアイデアを温めています...",
  "賢者の石で本質を抽出中...",
  "ルーン文字を解読しています...",
  "召喚サークルからアドバイスを呼び出し中...",
  "世界樹の根から情報を吸い上げています...",
  "魔法陣を展開。解析を開始します...",
  "光の精霊に意見を聞いています...",
  "あなたのスピーチに祝福の魔法を...",
  "星の配置からあなたの強みを占っています...",
  "忘却の呪文で「えーっと」を消去中...",
  "アカシックレコードにアクセスしています...",
  "羊皮紙にフィードバックを書き記しています...",
  "見えざる手がお手伝いしています...",
  "魔法薬を調合中... あとカエルの目玉が一つ...",
  "あなたのカリスマにリミッターを解除...",
  // 牧歌的
  "アイデアの種を植えています...",
  "小川のせせらぎに耳を澄ましています...",
  "羊の数を数えています...じゃなくて、フィラーワードを...",
  "焼きたてのパンのように、フィードバックをこねています...",
  "あなたの言葉を、そよ風に乗せて...",
  "村の長老が知恵を貸してくれています...",
  "星空の下で、あなたのスピーチを反芻しています...",
  "言葉の糸で美しいタペストリーを織っています...",
  "インスピレーションの泉で水を汲んでいます...",
  "静かな森で思考を整理しています...",
  "あなたの話から、熟した果実を収穫中...",
  "暖炉のそばで、改善点を考えています...",
  "雨上がりの虹を探しています...",
  "鳥のさえずりがヒントをくれました...",
  "ゆっくりと、丁寧に、言葉を紡いでいます...",
  "地平線に昇る朝日を待っています...",
  "あなたの声の響きを、山のこだまに聞いています...",
  "畑を耕し、新しい視点を育てています...",
  "井戸端会議であなたの評判を聞いています...",
  "お茶を一杯。さて、もう一仕事です...",
];
let messageInterval = null;
let summaryTimeout = null; // タイムアウトIDを保持する変数

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

// --- タイムアウト処理 ---
function handleTimeout() {
  stopLoadingAnimation();
  chrome.action.setBadgeText({ text: '' }); // バッジを非表示にする
  document.getElementById('loading-container').style.display = 'none';
  document.getElementById('summary-content').style.display = 'none';
  document.getElementById('error-container').style.display = 'none';
  
  // タイムアウト用のコンテナを表示
  const timeoutContainer = document.getElementById('timeout-container');
  if (timeoutContainer) {
    timeoutContainer.style.display = 'block';
  }
}


// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
  startLoadingAnimation();
  
  // 15秒後にタイムアウト処理を実行するタイマーを設定
  summaryTimeout = setTimeout(handleTimeout, 15000);

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
  // サマリーが表示される前にタイムアウトタイマーをクリア
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }

  const loadingContainer = document.getElementById('loading-container');
  const errorContainer = document.getElementById('error-container');
  const summaryContent = document.getElementById('summary-content');
  const timeoutContainer = document.getElementById('timeout-container');

  // 正常な応答があった場合は、タイムアウト表示を確実に非表示にする
  if (timeoutContainer) {
    timeoutContainer.style.display = 'none';
  }

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
        ? ['明朗さ', '情熱度', '論理性', '構成力', '自信']
        : ['掴みの強さ', 'エンタメ性', '緩急', 'キラーフレーズ', '安全性'];
      
      const scores = (mode === 'presenter')
        ? [data.scores.clarity, data.scores.passion, data.scores.logic, data.scores.structure, data.scores.confidence]
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