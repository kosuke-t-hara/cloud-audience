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

  // --- ★★★ 追加: 練習モード関連の要素 ★★★ ---
  const practiceModeRadios = document.querySelectorAll('input[name="practice_mode"]');
  const roleSelectionSection = document.getElementById('role-selection-section');
  const feedbackMethodSection = document.getElementById('feedback-method-section');
  const advancedSettingsAccordion = document.getElementById('advanced-settings-accordion');
  const faceAnalysisSection = document.getElementById('face-analysis-section');

  // --- Firebaseの初期化 ---
  const app = firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore(); // Firestoreを初期化

  // --- ★★★ 変更: 練習モードに応じて設定項目を切り替える関数 ★★★ ---
  function togglePracticeSettings() {
    const selectedPracticeMode = document.querySelector('input[name="practice_mode"]:checked').value;
    const isMissionMode = selectedPracticeMode === 'mission';

    // 練習モードに応じて、アコーディオン外の項目を非表示/表示
    roleSelectionSection.style.display = isMissionMode ? 'none' : 'block';
    feedbackMethodSection.style.display = isMissionMode ? 'none' : 'block';

    // 練習モードに応じて、アコーディオン内の項目を非表示/表示
    faceAnalysisSection.style.display = isMissionMode ? 'none' : 'block';

    // ペルソナ設定は、ミッションモードでは常に非表示。フリープレイモードでは役割設定に依存する。
    if (isMissionMode) {
      personaInputSection.style.display = 'none';
    } else {
      // フリープレイモードに戻った際は、役割設定に応じた表示状態を再評価する
      togglePersonaInput();
    }
  }

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
        chrome.runtime.sendMessage({ type: 'SIGN_IN_WITH_TOKEN', idToken: idToken }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("ログイン処理中にエラー:", chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            // ログイン成功の応答を受け取ったら、UIを即時更新
            updateUI(response.user);
          } else {
            console.error("バックグラウンドでのログインに失敗しました:", response?.error);
          }
        });
      } catch (error) {
        console.error("トークンの処理中にエラーが発生しました:", error);
      }
    });
  });

  logoutButton.addEventListener('click', () => {
    auth.signOut();
  });

  const openHistoryPage = () => {
    const webAppUrl = `https://${firebaseConfig.projectId}.web.app/dashboard.html`;
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

  // --- ★★★ 追加: 練習モードのラジオボタンにイベントリスナーを設定 ★★★ ---
  practiceModeRadios.forEach(radio => {
    radio.addEventListener('change', togglePracticeSettings);
  });

  // --- ペルソナ入力欄の表示/非表示ロジック ---
  function togglePersonaInput() {
    const selectedPracticeMode = document.querySelector('input[name="practice_mode"]:checked').value;
    
    // ミッションモードの場合は、役割に関わらず常に非表示
    if (selectedPracticeMode === 'mission') {
      personaInputSection.style.display = 'none';
      return;
    }

    // フリープレイモードの場合、役割に応じて表示を切り替え
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    personaInputSection.style.display = (selectedMode === 'presenter' || selectedMode === 'thinking') ? 'block' : 'none';
  }

  modeRadios.forEach(radio => {
    radio.addEventListener('change', togglePersonaInput);
  });

  // --- 設定の読み込みとUIへの反映 ---
  function loadSettings() {
    chrome.storage.local.get([
      'lastLanguage', 'lastMode', 'lastPersona', 'lastFeedbackMode',
      'lastFaceAnalysis', 'silenceThreshold', 'pauseDuration',
      'lastPracticeMode' // ★★★ 追加: 練習モードを読み込む ★★★
    ], (result) => {
      if (result.lastLanguage) document.querySelector(`input[name="language"][value="${result.lastLanguage}"]`).checked = true;
      if (result.lastMode) document.querySelector(`input[name="mode"][value="${result.lastMode}"]`).checked = true;
      if (result.lastPersona) personaText.value = result.lastPersona;
      if (result.lastFeedbackMode) document.querySelector(`input[name="feedback_mode"][value="${result.lastFeedbackMode}"]`).checked = true;
      if (result.lastFaceAnalysis) document.querySelector(`input[name="face_analysis"][value="${result.lastFaceAnalysis}"]`).checked = true;
      // ★★★ 追加: 練習モードを設定し、UIを更新 ★★★
      if (result.lastPracticeMode) {
        document.querySelector(`input[name="practice_mode"][value="${result.lastPracticeMode}"]`).checked = true;
      }

      const silenceThreshold = result.silenceThreshold !== undefined ? parseFloat(result.silenceThreshold) : 0.02;
      thresholdSlider.value = silenceThreshold;
      thresholdValueSpan.textContent = silenceThreshold.toFixed(3);

      const pauseDuration = result.pauseDuration !== undefined ? parseInt(result.pauseDuration, 10) : 5;
      pauseDurationSlider.value = pauseDuration;
      pauseDurationValueSpan.textContent = pauseDuration;

      togglePersonaInput();
      togglePracticeSettings(); // ★★★ 追加: 初期表示時にも設定を反映 ★★★
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
    const practiceMode = document.querySelector('input[name="practice_mode"]:checked').value;

    const settings = {
      lastPracticeMode: practiceMode, // ★★★ 追加: 練習モードを保存 ★★★
      lastLanguage: document.querySelector('input[name="language"]:checked').value,
      lastMode: document.querySelector('input[name="mode"]:checked').value,
      lastPersona: (document.querySelector('input[name="mode"]:checked').value === 'presenter' || document.querySelector('input[name="mode"]:checked').value === 'thinking') ? personaText.value : null,
      lastFeedbackMode: document.querySelector('input[name="feedback_mode"]:checked').value,
      lastFaceAnalysis: document.querySelector('input[name="face_analysis"]:checked').value,
      silenceThreshold: parseFloat(thresholdSlider.value),
      pauseDuration: parseInt(pauseDurationSlider.value, 10)
    };

    chrome.storage.local.set(settings).then(() => {
      if (practiceMode === 'free') {
        chrome.runtime.sendMessage({
          action: "start",
          ...settings
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
          } else {
            console.log(response?.message);
          }
          window.close();
        });
      } else if (practiceMode === 'mission') {
        startMission("reconcile_with_ai_01", settings); // MVPでは固定
      }
    });
  });

  // --- 停止ボタンのイベントリスナー ---
  stopButton.addEventListener('click', () => {
    stopButton.disabled = true;
    stopButton.textContent = '生成中...';

    chrome.runtime.sendMessage({ action: "stop" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("停止処理中にエラー:", chrome.runtime.lastError.message);
        window.close();
      } else {
        console.log("バックグラウンドからの応答:", response?.message);
        window.close();
      }
    });
  });

  // --- Mission Mode Functions (Firestore access) ---
  async function startMission(missionId, settings) {
    try {
      const missionDoc = await db.collection('missions').doc(missionId).get();
      if (missionDoc.exists) {
        const missionData = missionDoc.data();
        
        const missionUrl = chrome.runtime.getURL(`mission.html?mission_id=${missionId}`);
        chrome.tabs.create({ url: missionUrl }, (tab) => {
          // background.jsに録音開始を依頼
          chrome.runtime.sendMessage({
            action: "startMission",
            persona: missionData.persona,
            settings: settings,
            tabId: tab.id // 作成したタブのIDを渡す
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
            } else {
              console.log(response?.message);
            }
            window.close(); // メッセージ送信後にポップアップを閉じる
          });
        });
      } else {
        console.error("Mission not found in Firestore:", missionId);
        // TODO: ユーザーにエラーを通知
        window.close();
      }
    } catch (error) {
      console.error("Error starting mission:", error);
      // TODO: ユーザーにエラーを通知
      window.close();
    }
  }
});