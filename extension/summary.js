chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const loader = document.getElementById('loader');
  const errorContainer = document.getElementById('error-container');
  const summaryContent = document.getElementById('summary-content');

  if (request.type === 'show_summary') {
    // ローディングを非表示にし、サマリーを表示
    loader.style.display = 'none';
    summaryContent.style.display = 'block';

    const mode = request.mode;
    const data = request.data;

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
      new Chart(ctx, {
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

    } else if (mode === 'thinking') {
      // 思考パートナーモードの処理
      document.getElementById('thinking-summary').style.display = 'block';

      document.getElementById('summary-text').textContent = data.summary_text;
      
      const keyPointsList = document.getElementById('key-points-list');
      data.key_points.forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        keyPointsList.appendChild(li);
      });

      const newIdeasList = document.getElementById('new-ideas-list');
      data.new_ideas.forEach(idea => {
        const li = document.createElement('li');
        li.textContent = idea;
        newIdeasList.appendChild(li);
      });
    }
  } else if (request.type === 'show_summary_error') {
    // ローディングを非表示にし、エラーを表示
    loader.style.display = 'none';
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