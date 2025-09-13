document.addEventListener('DOMContentLoaded', function () {
  // --- DOM要素の取得 ---
  const loadingView = document.getElementById('loading-view');
  const loggedInView = document.getElementById('logged-in-view');
  const loggedOutView = document.getElementById('logged-out-view');
  const userInfo = document.getElementById('user-info');
  const loginButton = document.getElementById('login-button');
  const logoutButton = document.getElementById('logout-button');
  const viewHistoryLinkLoggedIn = document.getElementById('view-history-link-logged-in');
  const viewHistoryLinkLoggedOut = document.getElementById('view-history-link-logged-out');

  // --- 既存のUI要素 ---
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const personaInputSection = document.getElementById('persona-input-section');
  const personaText = document.getElementById('persona-text');
  const thresholdSlider = document.getElementById('silence-threshold-slider');
  const thresholdValueSpan = document.getElementById('silence-threshold-value');
  const pauseDurationSlider = document.getElementById('pause-duration-slider');
  const pauseDurationValueSpan = document.getElementById('pause-duration-value');
  const accordionToggle = document.querySelector('.accordion-toggle');
  const accordionContent = document.querySelector('.accordion-content');

  // --- Firebaseの初期化 ---
  const app = firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  // --- UI更新関数 ---
  function updateUI(user) {
    loadingView.style.display = 'none';
    if (user) {
      loggedInView.style.display = 'block';
      loggedOutView.style.display = 'none';
      userInfo.textContent = `${user.displayName || user.email} としてログイン中`;
      loadSettings();
    } else {
      loggedInView.style.display = 'none';
      loggedOutView.style.display = 'block';
      userInfo.textContent = '';
    }
  }

  // --- バックグラウンドからの通知を待ち受けるリスナー ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'AUTH_STATE_CHANGED') {
      updateUI(request.user);
    }
  });

  // --- ポップアップ起動時に現在の認証状態を問い合わせ ---
  chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (response) => {
    if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        updateUI(null);
        return;
    }
    if (response) {
      updateUI(response.loggedIn ? response.user : null);
    } else {
      updateUI(null);
    }
  });

  // --- 認証関連のイベントリスナー ---
  loginButton.addEventListener('click', () => {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2.client_id;
    const scopes = manifest.oauth2.scopes.join(' ');
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('nonce', Math.random().toString(36).substring(2));

    chrome.identity.launchWebAuthFlow({
      url: authUrl.href,
      interactive: true
    }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        console.error("認証に失敗しました:", chrome.runtime.lastError?.message || "レスポンスがありません");
        return;
      }

      try {
        const url = new URL(responseUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        const idToken = params.get('id_token');

        if (!idToken) {
          console.error("IDトークンが見つかりません");
          return;
        }

        const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
        // Firebaseへのログイン処理はバックグラウンドに任せる
        chrome.runtime.sendMessage({ type: 'SIGN_IN_WITH_TOKEN', idToken: idToken });
        // auth.signInWithCredential(credential)
        //   .catch((error) => {
        //     console.error("Firebaseへのログインに失敗しました:", error);
        //   });
      } catch (error) {
        console.error("トークンの処理中にエラーが発生しました:", error);
      }
    });
  });

  logoutButton.addEventListener('click', () => {
    auth.signOut();
  });

  const openHistoryPage = () => {
    const webAppUrl = `https://${firebaseConfig.projectId}.web.app/history.html`;
    chrome.tabs.create({ url: webAppUrl });
  };
  viewHistoryLinkLoggedIn.addEventListener('click', openHistoryPage);
  viewHistoryLinkLoggedOut.addEventListener('click', openHistoryPage);


  // --- 以下、既存の機能のロジック (変更なし) ---

  // --- アコーディオンの開閉ロジック ---
  accordionToggle.addEventListener('click', () => {
    const isOpen = accordionToggle.classList.toggle('active');
    accordionContent.style.display = isOpen ? 'block' : 'none';
    if (isOpen) {
      togglePersonaInput();
    }
  });

  // --- ペルソナ入力欄の表示/非表示ロジック ---
  function togglePersonaInput() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    personaInputSection.style.display = (selectedMode === 'presenter' || selectedMode === 'creator') ? 'block' : 'none';
  }

  modeRadios.forEach(radio => {
    radio.addEventListener('change', togglePersonaInput);
  });

  // --- 設定の読み込みとUIへの反映 ---
  function loadSettings() {
    chrome.storage.local.get([
      'lastLanguage', 'lastMode', 'lastPersona', 'lastFeedbackMode',
      'lastFaceAnalysis', 'silenceThreshold', 'pauseDuration'
    ], (result) => {
      if (result.lastLanguage) document.querySelector(`input[name="language"][value="${result.lastLanguage}"]`).checked = true;
      if (result.lastMode) document.querySelector(`input[name="mode"][value="${result.lastMode}"]`).checked = true;
      if (result.lastPersona) personaText.value = result.lastPersona;
      if (result.lastFeedbackMode) document.querySelector(`input[name="feedback_mode"][value="${result.lastFeedbackMode}"]`).checked = true;
      if (result.lastFaceAnalysis) document.querySelector(`input[name="face_analysis"][value="${result.lastFaceAnalysis}"]`).checked = true;

      const silenceThreshold = result.silenceThreshold !== undefined ? parseFloat(result.silenceThreshold) : 0.02;
      thresholdSlider.value = silenceThreshold;
      thresholdValueSpan.textContent = silenceThreshold.toFixed(3);

      const pauseDuration = result.pauseDuration !== undefined ? parseInt(result.pauseDuration, 10) : 5;
      pauseDurationSlider.value = pauseDuration;
      pauseDurationValueSpan.textContent = pauseDuration;

      togglePersonaInput();
    });
  }

  // --- スライダーのイベントリスナー ---
  thresholdSlider.addEventListener('input', () => {
    const value = parseFloat(thresholdSlider.value);
    thresholdValueSpan.textContent = value.toFixed(3);
    chrome.storage.local.set({ silenceThreshold: value });
  });

  pauseDurationSlider.addEventListener('input', () => {
    const value = parseInt(pauseDurationSlider.value, 10);
    pauseDurationValueSpan.textContent = value;
    chrome.storage.local.set({ pauseDuration: value });
  });

  // --- 開始ボタンのイベントリスナー ---
  startButton.addEventListener('click', () => {
    const settings = {
      lastLanguage: document.querySelector('input[name="language"]:checked').value,
      lastMode: document.querySelector('input[name="mode"]:checked').value,
      lastPersona: (document.querySelector('input[name="mode"]:checked').value === 'presenter' || document.querySelector('input[name="mode"]:checked').value === 'creator') ? personaText.value : null,
      lastFeedbackMode: document.querySelector('input[name="feedback_mode"]:checked').value,
      lastFaceAnalysis: document.querySelector('input[name="face_analysis"]:checked').value,
      silenceThreshold: parseFloat(thresholdSlider.value),
      pauseDuration: parseInt(pauseDurationSlider.value, 10)
    };

    chrome.storage.local.set(settings).then(() => {
      chrome.runtime.sendMessage({
        action: "start",
        ...settings
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
        } else {
          console.log(response?.message);
        }
      });
    });
  });

  // --- 停止ボタンのイベントリスナー ---
  stopButton.addEventListener('click', () => {
    stopButton.disabled = true;
    stopButton.textContent = '生成中...';

    chrome.runtime.sendMessage({ action: "stop" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("停止処理中にエラー:", chrome.runtime.lastError.message);
        // エラーが発生してもウィンドウは閉じる
        window.close();
      } else {
        console.log("バックグラウンドからの応答:", response?.message);
        // 応答を受け取ってからウィンドウを閉じる
        window.close();
      }
    });
  });
});