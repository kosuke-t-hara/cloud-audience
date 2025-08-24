chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'show_summary') {
    const data = request.data;
    
    // テキスト部分を表示
    document.getElementById('highlight').textContent = data.highlight;
    document.getElementById('advice').textContent = data.advice;
    
    // レーダーチャートを描画
    const ctx = document.getElementById('radarChart').getContext('2d');
    new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['明朗さ', '情熱度', '示唆度', '構成力', '自信'],
        datasets: [{
          label: 'プレゼンスコア',
          data: [
            data.scores.clarity,
            data.scores.passion,
            data.scores.insightfulness,
            data.scores.structure,
            data.scores.confidence
          ],
          backgroundColor: 'rgba(66, 133, 244, 0.2)',
          borderColor: 'rgba(66, 133, 244, 1)',
          borderWidth: 2
        }]
      },
      options: {
        scales: {
          r: {
            beginAtZero: true,
            max: 5,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }
});