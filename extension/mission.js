document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const briefingView = document.getElementById('briefing-view');
    const activeView = document.getElementById('active-view');
    const resultsView = document.getElementById('results-view');

    const missionTitle = document.getElementById('mission-title');
    const missionScenario = document.getElementById('mission-scenario');
    const missionObjective = document.getElementById('mission-objective');
    const startMissionButton = document.getElementById('start-mission-button');

    const statusText = document.getElementById('status-text');
    const transcriptLog = document.getElementById('transcript-log');

    const resultMessage = document.getElementById('result-message');
    const scoreDisplay = document.getElementById('score');
    const showLeaderboardButton = document.getElementById('show-leaderboard-button');
    const retryMissionButton = document.getElementById('retry-mission-button');

    // --- Firebaseの初期化 ---
    const app = firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const auth = firebase.auth();

    let currentMissionId = null;
    let currentUser = null;

    // --- 初期化処理 ---
    function init() {
        // 1. URLからmission_idを取得
        const params = new URLSearchParams(window.location.search);
        currentMissionId = params.get('mission_id');
        if (!currentMissionId) {
            console.error('Mission ID is missing.');
            missionTitle.textContent = 'エラー: ミッションIDが見つかりません。';
            return;
        }

        // 2. ユーザーの認証状態を確認
        auth.onAuthStateChanged(user => {
            if (user) {
                currentUser = user;
                // 3. Firestoreからミッションデータを取得して表示
                loadMissionData();
            } else {
                // ログインしていない場合はエラー表示などを行う
                console.error("User is not authenticated.");
                missionTitle.textContent = 'エラー: ログインしていません。';
            }
        });
    }

    // --- Firestoreからミッションデータを読み込む ---
    async function loadMissionData() {
        try {
            const missionDoc = await db.collection('missions').doc(currentMissionId).get();
            if (missionDoc.exists) {
                const missionData = missionDoc.data();
                missionTitle.textContent = missionData.title || '無題のミッション';
                missionScenario.textContent = missionData.scenario || 'シナリオの説明がありません。';
                missionObjective.textContent = missionData.objective || 'クリア条件が設定されていません。';
            } else {
                console.error('Mission not found in Firestore.');
                missionTitle.textContent = 'エラー: ミッションが見つかりません。';
            }
        } catch (error) {
            console.error('Error loading mission data:', error);
            missionTitle.textContent = 'エラー: ミッションの読み込みに失敗しました。';
        }
    }

    // --- 対話ログに新しいメッセージを追加する ---
    function addTranscript(speaker, text) {
        const p = document.createElement('p');
        p.classList.add(speaker); // 'user' or 'ai'
        p.textContent = text;
        transcriptLog.appendChild(p);
        transcriptLog.scrollTop = transcriptLog.scrollHeight; // 自動スクロール
    }

    // --- イベントリスナーの設定 ---
    startMissionButton.addEventListener('click', () => {
        // UIを対話ビューに切り替え
        briefingView.style.display = 'none';
        activeView.style.display = 'block';
        statusText.textContent = 'マイクの準備をしています...';

        // background.jsにミッション開始を通知し、マイク入力を開始させる
        chrome.runtime.sendMessage({
            action: "startMission",
            missionId: currentMissionId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                statusText.textContent = 'エラー: 開始に失敗しました。';
            } else if (!response.success) {
                console.error('Failed to start mission:', response.error);
                statusText.textContent = `エラー: ${response.error}`;
            } else {
                console.log(response.message);
                // 実際のステータス更新はonMessageリスナーに任せる
            }
        });
    });

    // background.jsからのメッセージをリッスンする
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // このページからのメッセージは無視
        if (sender.tab) {
            return;
        }

        switch (request.type) {
            case 'TRANSCRIPT_UPDATE':
                addTranscript(request.speaker, request.text);
                break;
            case 'STATUS_UPDATE':
                statusText.textContent = request.status;
                break;
            case 'MISSION_COMPLETE': // background.js側でミッション完了を検知した場合
                finishMission();
                break;
            case 'show_error': // background.jsからのエラー通知
                statusText.textContent = `エラー: ${request.data}`;
                break;
        }
    });

    // --- ミッション完了処理 ---
    function finishMission() {
        statusText.textContent = 'ミッション完了！結果を計算しています...';
        
        // background.jsにスコアリングを依頼する
        const fullTranscript = transcriptLog.innerText;
        chrome.runtime.sendMessage({ 
            action: "requestScoring", 
            missionId: currentMissionId,
            transcript: fullTranscript 
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                displayResults({ success: false, message: 'スコアの計算中にエラーが発生しました。', score: 0 });
            } else if (!response.success) {
                console.error('Scoring failed:', response.error);
                displayResults({ success: false, message: `スコア計算エラー: ${response.error}`, score: 0 });
            } else {
                displayResults(response.results);
            }
        });
    }

    // --- 結果を表示し、Firestoreに保存する ---
    async function displayResults(results) {
        activeView.style.display = 'none';
        resultsView.style.display = 'block';

        resultMessage.textContent = results.message || (results.success ? 'ミッション成功！' : 'ミッション失敗');
        scoreDisplay.textContent = `${results.score || 0}点`;

        // Firestoreにスコアを保存する
        if (currentUser && results.success) {
            try {
                await db.collection('missions').doc(currentMissionId).collection('leaderboard').add({
                    userId: currentUser.uid,
                    displayName: currentUser.displayName || currentUser.email,
                    score: results.score,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('Score saved successfully.');
            } catch (error) {
                console.error('Error saving score:', error);
            }
        }
    }

    // --- 初期化処理の呼び出し ---
    init();
});
