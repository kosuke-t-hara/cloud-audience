document.addEventListener('DOMContentLoaded', function() {
  // Firebaseの初期化
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  // CLOUD_FUNCTION_URLは現在使用されていませんが、他の機能で利用される可能性を考慮し残します。
  const CLOUD_FUNCTION_URL = 'https://coachapi-hruygwmczq-an.a.run.app';

  // 認証状態の監視
  auth.onAuthStateChanged(user => {
    const currentPage = window.location.pathname.split('/').pop();
    if (user) {
      // ログイン済みの場合
      // もしログインページ(index.html)にいたら、ダッシュボードにリダイレクト
      if (currentPage === 'index.html' || currentPage === '') {
        window.location.href = 'dashboard.html';
      }
    } else {
      // 未ログインの場合
      // ログインページ以外にいたら、ログインページにリダイレクト
      if (currentPage !== 'index.html' && currentPage !== '') {
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
          // ログイン成功後のリダイレクトは onAuthStateChanged が自動的に処理します。
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
        // ログアウト後のリダイレクトは onAuthStateChanged が自動的に処理します。
      }).catch((error) => {
        console.error('ログアウトエラー:', error);
        alert('ログアウト中にエラーが発生しました。');
      });
    });
  }

});
