document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const briefingView = document.getElementById('briefing-view');
    const activeView = document.getElementById('active-view');
    const resultsView = document.getElementById('results-view');

    const missionTitle = document.getElementById('mission-title');
    const missionScenario = document.getElementById('mission-scenario');
    const missionObjective = document.getElementById('mission-objective');
    const startMissionButton = document.getElementById('start-mission-button');
    const finishMissionButton = document.getElementById('finish-mission-button');

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

    let isFinishing = false; // 完了処理中のフラグ

    // --- イベントリスナーの設定 ---
    startMissionButton.addEventListener('click', () => {
        // UIを対話ビューに切り替え
        briefingView.style.display = 'none';
        activeView.style.display = 'block';
        statusText.textContent = 'マイクの準備をしています...';

        // background.jsに音声記録の開始を通知する
        chrome.runtime.sendMessage({
            action: "startMissionAudio"
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                statusText.textContent = 'エラー: 開始に失敗しました。';
            } else if (response && !response.success) {
                console.error('Failed to start mission audio:', response.error);
                statusText.textContent = `エラー: ${response.error}`;
            } else {
                console.log(response?.message);
                statusText.textContent = 'AIの応答を待っています...'; // 成功したらステータスを更新
            }
        });
    });

    finishMissionButton.addEventListener('click', () => {
        finishMission();
    });

    showLeaderboardButton.addEventListener('click', () => {
        const url = `https://prezento-ai-coach.web.app/dashboard.html?tab=ranking&missionId=${currentMissionId}`;
        window.open(url, '_blank');
    });

    retryMissionButton.addEventListener('click', () => {
        location.reload();
    });

    // background.jsからのメッセージをリッスンする
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // このページからのメッセージは無視
        if (sender.tab) {
            return;
        }

        switch (request.type) {
            case 'MISSION_TRANSCRIPT_UPDATE':
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
        if (isFinishing) return; // 既に完了処理が始まっていれば何もしない
        isFinishing = true;
        finishMissionButton.disabled = true; // ボタンを無効化
        statusText.textContent = 'ミッション完了！結果を計算しています...';
        
        // ★★★ 変更: stopを呼び出し、短い遅延の後にスコアリングを依頼 ★★★
        chrome.runtime.sendMessage({ action: "stop" });

        setTimeout(() => {
            // 構造化された対話ログを生成
            const conversationLog = [];
            transcriptLog.querySelectorAll('p').forEach(p => {
                conversationLog.push({
                    speaker: p.classList.contains('user') ? 'user' : 'ai',
                    text: p.textContent
                });
            });
            
            const objectiveText = missionObjective.textContent;
            chrome.runtime.sendMessage({ 
                action: "requestScoring", 
                missionId: currentMissionId,
                conversationLog: conversationLog,
                objective: objectiveText
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Scoring message failed:", chrome.runtime.lastError.message);
                    displayResults({ success: false, message: 'スコアの計算中にエラーが発生しました。', score: 0 });
                } else if (response && !response.success) {
                    console.error('Scoring failed on server:', response.error);
                    displayResults({ success: false, message: `スコア計算エラー: ${response.error}`, score: 0 });
                } else if (response) {
                    displayResults(response.results);
                } else {
                    // responseがundefinedの場合のフォールバック
                    displayResults({ success: false, message: 'スコアサーバーから予期しない応答がありました。', score: 0 });
                }
            });
        }, 100); // 100ミリ秒の遅延
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
