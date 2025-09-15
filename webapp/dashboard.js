// dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            initializeDashboard(user);
        } else {
            window.location.href = 'index.html';
        }
    });
});

function initializeDashboard(user) {
    setupTabs();
    loadAndRenderData(user.uid);
}

function setupTabs() {
    // (変更なし)
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            tabLinks.forEach(item => item.classList.remove('active'));
            tabContents.forEach(item => item.classList.remove('active'));
            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

/**
 * 5つのスコアから合計値を計算するヘルパー関数
 * @param {object} scores - {clarity, passion, ...}
 * @returns {number} 合計スコア
 */
function calculateTotalScore(scores) {
    if (!scores) return 0;
    return Object.values(scores).reduce((total, score) => total + score, 0);
}

async function loadAndRenderData(userId) {
    const db = firebase.firestore();
    const sessionsRef = db.collection('users').doc(userId).collection('sessions');
    
    try {
        const q = sessionsRef.orderBy('createdAt', 'desc').limit(100);
        const querySnapshot = await q.get();

        const sessions = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        if (sessions.length > 0) {
            renderPerformanceSummary(sessions); // ★ 新しいサマリー表示関数
            renderScoreChart(sessions);
            renderActivityList(sessions);
        } else {
            document.getElementById('analytics').innerHTML = '<p>まだ練習履歴がありません。最初の練習を始めましょう！</p>';
            document.getElementById('activity').innerHTML = '<p>練習履歴はありません。</p>';
        }
    } catch (error) {
        console.error("Error fetching session data: ", error);
        document.getElementById('analytics').innerHTML = '<p>データの読み込み中にエラーが発生しました。</p>';
        document.getElementById('activity').innerHTML = '<p>データの読み込み中にエラーが発生しました。</p>';
    }
}



/**
 * ★ パフォーマンスサマリー（最高・最低・平均）を描画する
 * @param {Array<object>} sessions
 */
function renderPerformanceSummary(sessions) {
    const totalScores = sessions.map(s => calculateTotalScore(s.scores));
    
    const highScore = Math.max(...totalScores);
    const lowScore = Math.min(...totalScores);
    const avgScore = Math.round(totalScores.reduce((sum, score) => sum + score, 0) / totalScores.length);

    document.getElementById('high-score').textContent = highScore;
    document.getElementById('low-score').textContent = lowScore;
    document.getElementById('avg-score').textContent = avgScore;
}

/**
 * ★ 積み上げエリアチャートを描画する
 * @param {Array<object>} sessions
 */
function renderScoreChart(sessions) {
    const ctx = document.getElementById('score-chart').getContext('2d');
    
    const reversedSessions = [...sessions].reverse();
    const labels = reversedSessions.map(s => s.createdAt.toDate().toLocaleDateString('ja-JP'));

    const scoreKeys = ['clarity', 'passion', 'insightfulness', 'structure', 'confidence'];
    const scoreLabels = {
        clarity: '明瞭さ',
        passion: '情熱',
        insightfulness: '洞察力',
        structure: '構成力',
        confidence: '自信'
    };
    const colors = {
        clarity: 'rgba(54, 162, 235, 0.5)',
        passion: 'rgba(255, 99, 132, 0.5)',
        insightfulness: 'rgba(255, 206, 86, 0.5)',
        structure: 'rgba(75, 192, 192, 0.5)',
        confidence: 'rgba(153, 102, 255, 0.5)'
    };

    const datasets = scoreKeys.map(key => ({
        label: scoreLabels[key],
        data: reversedSessions.map(s => s.scores?.[key] || 0),
        backgroundColor: colors[key],
        borderColor: 'rgba(255,255,255,0.5)',
        borderWidth: 1,
        fill: true,
    }));

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    stacked: true, // 積み上げ
                    max: 500 // Y軸の最大値
                },
                x: {
                    stacked: true
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            elements: {
                line: {
                    tension: 0.3
                }
            }
        }
    });
}

function renderActivityList(sessions) {
    const container = document.getElementById('activity-list-container');
    container.innerHTML = '';

    sessions.forEach(session => {
        const card = document.createElement('div');
        card.className = 'activity-card';
        
        const sessionDate = session.createdAt.toDate();
        const duration = session.duration || '記録なし';
        const totalScore = calculateTotalScore(session.scores);

        card.innerHTML = `
            <div class="info">
                <h3>${sessionDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}</h3>
                <p>練習時間: ${duration}</p>
            </div>
            <div class="score">
                <span>${totalScore}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            window.location.href = `session.html?sessionId=${session.id}`;
        });

        container.appendChild(card);
    });
}
