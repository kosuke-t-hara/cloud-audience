document.addEventListener('DOMContentLoaded', function() {
  // Firebaseの初期化
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';

  // 認証状態の監視
  auth.onAuthStateChanged(user => {
    if (user) {
      // ログイン済み
      const currentPage = window.location.pathname.split('/').pop();
      if (currentPage === 'index.html' || currentPage === '') {
        window.location.href = 'history.html';
      } else if (currentPage === 'history.html') {
        // history.htmlにいる場合、履歴を取得して表示
        fetchAndRenderHistory(user);
        // ユーザー情報を表示
        const userEmailElement = document.getElementById('user-email');
        if(userEmailElement) {
          userEmailElement.textContent = user.email;
        }
      }
    } else {
      // 未ログイン
      const currentPage = window.location.pathname.split('/').pop();
      if (currentPage !== 'index.html' && currentPage !== '') {
        // ログインページ以外にいたらリダイレクト
        window.location.href = 'index.html';
      }
    }
  });

  // ログイン処理
  const loginButton = document.getElementById('login-button');
  if (loginButton) {
    loginButton.addEventListener('click', () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider)
        .then((result) => {
          console.log("signInWithPopup 成功:", result.user.displayName);
        })
        .catch((error) => {
          console.error("signInWithPopup エラー:", error);
          alert('ログイン中にエラーが発生しました: ' + error.message);
        });
    });
  }

  // ログアウト処理
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      auth.signOut().then(() => {
        console.log('ログアウトしました。');
        window.location.href = 'index.html';
      }).catch((error) => {
        console.error('ログアウトエラー:', error);
        alert('ログアウト中にエラーが発生しました。');
      });
    });
  }

  // 履歴を取得して描画する関数
  async function fetchAndRenderHistory(user) {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    container.innerHTML = '<p>履歴を読み込んでいます...</p>';

    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ type: 'get-history' })
      });

      if (!response.ok) {
        throw new Error(`APIエラー: ${response.status}`);
      }

      const historyList = await response.json();

      if (historyList.length === 0) {
        container.innerHTML = '<p>練習履歴はまだありません。</p>';
        return;
      }

      // 履歴を描画
      renderHistory(historyList);

    } catch (error) {
      console.error('履歴の取得に失敗しました:', error);
      container.innerHTML = '<p>履歴の読み込み中にエラーが発生しました。</p>';
    }
  }

  // 履歴データをHTMLに変換して表示する関数
  function renderHistory(historyList) {
    const container = document.getElementById('history-list-container');
    let html = '';

    historyList.forEach(item => {
      const date = new Date(item.createdAt).toLocaleString('ja-JP');
      const totalScore = item.totalScore || 'N/A';
      const highlight = item.highlight ? item.highlight.replace(/\n/g, '<br>') : 'なし';
      const advice = item.advice ? item.advice.replace(/\n/g, '<br>') : 'なし';

      html += `
        <div class="history-item">
          <div class="history-header">
            <h3>練習日時: ${date}</h3>
            <p class="total-score">総合スコア: <span>${totalScore}</span></p>
          </div>
          <div class="history-body">
            <h4>ハイライト</h4>
            <p>${highlight}</p>
            <h4>アドバイス</h4>
            <p>${advice}</p>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }
});