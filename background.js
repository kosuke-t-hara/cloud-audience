// background.js

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  try {
    if (request.action === "start") {
      console.log("「開始」メッセージを受信しました。");
      await setupOffscreenDocument('offscreen.html');
      chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen' });
      sendResponse({ message: "練習を開始しました。" });

    } else if (request.action === "stop") {
      console.log("「停止」メッセージを受信しました。");
      chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
      sendResponse({ message: "練習を停止しました。" });
      
    } else if (request.type === 'transcript-ready') {
      console.log("受け取ったテキスト:", request.data);
      handleTranscript(request.data);
      // このメッセージには応答がないので、sendResponseは不要
    }
  } catch (error) {
    console.error("background.jsでエラーが発生しました:", error);
    // エラーが発生した場合でも、応答を返してエラーを防ぐ
    sendResponse({ message: "エラーが発生しました。", error: error.message });
  }
  
  // 非同期でsendResponseを呼び出す場合はtrueを返す必要がある
  return true; 
});

async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: 'マイクからの音声を取得するため',
  });
}