// dashboard.js

document.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            // ユーザー名の表示
            const userNameElement = document.getElementById('user-name');
            if (userNameElement) {
                userNameElement.textContent = user.displayName || user.email;
            }
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
            renderPerformanceSummary(sessions);
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
 * パフォーマンスサマリー（最高・最低・平均）を描画する
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
 * 積み上げエリアチャートを描画する
 * @param {Array<object>} sessions
 */
function renderScoreChart(sessions) {
    const ctx = document.getElementById('score-chart').getContext('2d');
    
    const reversedSessions = [...sessions].reverse();
    const labels = reversedSessions.map(s => {
        const date = s.createdAt.toDate();
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    });

    const scoreKeys = ['clarity', 'passion', 'logic', 'structure', 'confidence'];
    const scoreLabels = {
        clarity: '明瞭さ',
        passion: '情熱',
        logic: '論理性',
        structure: '構成力',
        confidence: '自信'
    };
    const colors = {
        clarity: 'rgba(128, 90, 213, 0.6)',
        passion: 'rgba(159, 122, 234, 0.6)',
        logic: 'rgba(196, 181, 253, 0.6)',
        structure: 'rgba(221, 214, 254, 0.6)',
        confidence: 'rgba(237, 233, 254, 0.8)'
    };

    const datasets = scoreKeys.map(key => ({
        label: scoreLabels[key],
        data: reversedSessions.map(s => s.scores?.[key] || 0),
        backgroundColor: colors[key],
        borderColor: 'rgba(128, 90, 213, 0.8)',
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
                    stacked: true,
                    max: 500,
                    title: { display: true, text: '総合得点' }
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
    container.innerHTML = ''; // Clear previous content

    if (sessions.length === 0) {
        container.innerHTML = '<p>練習履歴はありません。</p>';
        return;
    }

    // アイコンSVGの定義
    const icons = {
        presenter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
        thinking: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>',
        default: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8.5 12.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3.5 4c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zm3.5-4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>'
    };

    sessions.forEach(session => {
        const card = document.createElement('div');
        card.className = 'activity-card';
        
        const displayName = session.persona ? session.persona : 'AI Coach';
        const personaComment = session.persona_comment || 'このセッションに関するコメントはありません。';
        const sessionDate = session.createdAt.toDate();
        const sessionMode = session.mode || 'default';

        const iconSvg = icons[sessionMode] || icons.default;
        
        // ペルソナ名から色を生成
        const personaColor = hashCodeToHsl(stringToHashCode(displayName));

        // 新仕様: 合計スコアの計算
        const totalScore = calculateTotalScore(session.scores);

        const truncatedName = displayName.length > 20 ? displayName.substring(0, 20) + '...' : displayName;
        const truncatedComment = personaComment.length > 140 ? personaComment.substring(0, 140) + '...' : personaComment;
        const timeAgo = formatTimeAgo(sessionDate);
        const fullDate = sessionDate.toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        card.innerHTML = `
            <div class="activity-card-icon" style="background-color: ${personaColor};">
                ${iconSvg}
            </div>
            <div class="activity-card-content">
                <div class="activity-card-header">
                    <span class="activity-card-username" title="${displayName}">${truncatedName}</span>
                    <div class="activity-card-meta">
                        <span class="activity-card-score">${totalScore}</span>
                        <span class="activity-card-time" data-tooltip="${fullDate}">${timeAgo}</span>
                    </div>
                </div>
                <p class="activity-card-comment">${truncatedComment}</p>
            </div>
        `;

        card.addEventListener('click', () => {
            window.location.href = `session.html?sessionId=${session.id}`;
        });

        container.appendChild(card);
    });
}

function formatTimeAgo(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 86400;
    if (interval > 1) {
        return Math.floor(interval) + "日前";
    }
    interval = seconds / 3600;
    if (interval > 1) {
        return Math.floor(interval) + "時間前";
    }
    interval = seconds / 60;
    if (interval > 1) {
        return Math.floor(interval) + "分前";
    }
    return Math.floor(seconds) + "秒前";
}

/**
 * 文字列からハッシュ値を生成する
 * @param {string} str
 * @returns {number}
 */
function stringToHashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // 32bit整数に変換
    }
    return hash;
}

/**
 * ハッシュ値からHSLカラーを生成する
 * @param {number} hash
 * @returns {string} HSLカラー文字列 (e.g., "hsl(120, 70%, 80%)")
 */
function hashCodeToHsl(hash) {
    const h = Math.abs(hash % 360);
    const s = 70; // 彩度
    const l = 80; // 明度
    return `hsl(${h}, ${s}%, ${l}%)`;
}