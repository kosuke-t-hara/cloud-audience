// session.js

document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            // ユーザー名の表示
            const userNameElement = document.getElementById('user-name');
            if (userNameElement) {
                userNameElement.textContent = user.displayName || user.email;
            }
            loadSessionData(user);
        } else {
            window.location.href = 'index.html';
        }
    });
});

async function loadSessionData(user) {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');

    if (!sessionId) {
        document.querySelector('.session-container').innerHTML = '<p>セッションIDが見つかりません。</p>';
        return;
    }

    const db = firebase.firestore();
    const sessionRef = db.collection('users').doc(user.uid).collection('sessions').doc(sessionId);

    try {
        const doc = await sessionRef.get();
        if (doc.exists) {
            const sessionData = doc.data();
            renderSessionDetails(sessionData);
        } else {
            document.querySelector('.session-container').innerHTML = '<p>指定されたセッションが見つかりません。</p>';
        }
    } catch (error) {
        console.error("Error fetching session:", error);
        document.querySelector('.session-container').innerHTML = '<p>データの読み込み中にエラーが発生しました。</p>';
    }
}

function renderSessionDetails(data) {
    // 日付
    document.getElementById('session-date').textContent = data.createdAt.toDate().toLocaleDateString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // 合計スコア
    const totalScore = Object.values(data.scores).reduce((sum, score) => sum + score, 0);
    document.getElementById('session-total-score').textContent = totalScore;

    // フィードバック
    document.getElementById('feedback-highlight').textContent = data.highlight || 'N/A';
    document.getElementById('feedback-advice').textContent = data.advice || 'N/A';
    document.getElementById('feedback-persona').textContent = data.persona_comment || 'N/A';

    // AIからの質問
    const questionsList = document.getElementById('ai-questions-list');
    questionsList.innerHTML = '';
    if (data.questions && data.questions.length > 0) {
        data.questions.forEach(q => {
            const li = document.createElement('li');
            li.textContent = q;
            questionsList.appendChild(li);
        });
    } else {
        questionsList.innerHTML = '<li>AIからの質問はありませんでした。</li>';
    }

    // フィードバック履歴
    const feedbackHistoryList = document.getElementById('feedback-history-list');
    feedbackHistoryList.innerHTML = '';
    if (data.feedbackHistory && data.feedbackHistory.length > 0) {
        data.feedbackHistory.forEach(item => {
            const div = document.createElement('div');
            div.classList.add('feedback-history-item');
            const transcriptP = document.createElement('p');
            transcriptP.classList.add('transcript');
            // item.transcript が存在する場合のみ表示
            if(item.transcript) {
              transcriptP.textContent = `あなた: ${item.transcript}`;
              div.appendChild(transcriptP);
            }
            const feedbackP = document.createElement('p');
            feedbackP.classList.add('feedback');
            feedbackP.textContent = `AI: ${item.feedback}`;
            div.appendChild(feedbackP);
            feedbackHistoryList.appendChild(div);
        });
    } else {
        feedbackHistoryList.innerHTML = '<p>リアルタイムフィードバックの履歴はありませんでした。</p>';
    }

    // ペルソナ設定の表示
    const personaContainer = document.getElementById('session-persona-container');
    const personaSpan = document.getElementById('session-persona');
    if (data.persona && data.persona.trim() !== '') {
        personaSpan.textContent = data.persona;
        personaContainer.style.display = 'flex'; // flexに変更して中央揃えに対応
    }

    // レーダーチャートを描画
    renderRadarChart(data.scores);
}

function renderRadarChart(scores) {
    const ctx = document.getElementById('score-radar-chart').getContext('2d');
    const labels = ['明朗さ', '情熱', '論理性', '構成力', '自信'];
    const data = [
        scores.clarity,
        scores.passion,
        scores.logic,
        scores.structure,
        scores.confidence
    ];

    new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'スコア',
                data: data,
                backgroundColor: 'rgba(107, 70, 193, 0.2)', // --primary-colorのRGBa
                borderColor: 'rgba(107, 70, 193, 1)',     // --primary-color
                borderWidth: 2,
                pointBackgroundColor: 'rgba(107, 70, 193, 1)' // --primary-color
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: {
                        display: true
                    },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    pointLabels: {
                        font: {
                            size: 14
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}
