document.addEventListener('DOMContentLoaded', function() {
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');

  startButton.addEventListener('click', () => {
    // background.jsへ { action: "start" } というメッセージを送信
    chrome.runtime.sendMessage({ action: "start" }, (response) => {
      console.log(response.message);
    });
  });

  stopButton.addEventListener('click', () => {
    // background.jsへ { action: "stop" } というメッセージを送信
    chrome.runtime.sendMessage({ action: "stop" }, (response) => {
      console.log(response.message);
    });
  });
});