// background.js (新アーキテクチャ版)
console.log('background.jsが読み込まれました');

let liveTabId = null;

// --- メインロジック ---
async function startSession() {
  if (liveTabId) {
    // すでにタブが開いている場合は、そのタブをアクティブにする
    chrome.tabs.update(liveTabId, { active: true });
    return;
  }

  // 新しいセッションタブを作成
  const tab = await chrome.tabs.create({ 
    url: chrome.runtime.getURL('live_session.html'),
    active: true
  });
  liveTabId = tab.id;
  console.log(`セッションタブ (ID: ${liveTabId}) を作成しました。`);
}

async function stopSession() {
  if (!liveTabId) return;
  
  // セッションタブを閉じる
  await chrome.tabs.remove(liveTabId);
  console.log(`セッションタブ (ID: ${liveTabId}) を閉じました。`);
  // liveTabId は onRemoved リスナーでクリアされる
}

// --- popup.jsからのメッセージハンドリング ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start") {
    startSession();
    sendResponse({ message: "セッションを開始します。" });
  } else if (request.action === "stop") {
    stopSession();
    sendResponse({ message: "セッションを停止します。" });
  }
  return true;
});

// タブが閉じられたことを検知するリスナー
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === liveTabId) {
    console.log(`セッションタブ (ID: ${liveTabId}) が閉じられたことを検知しました。`);
    liveTabId = null;
  }
});
