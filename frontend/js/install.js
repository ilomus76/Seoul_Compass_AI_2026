/* 설치 안내와 서비스 워커 등록은 여행 분석 화면과 독립적으로 동작한다. */
(function () {
  'use strict';
  const button = document.getElementById('installApp');
  const dialog = document.getElementById('installHelp');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installed = false;

  function updateButton() {
    button.hidden = installed || standalone.matches || navigator.standalone === true;
    if (button.hidden && dialog.open) dialog.close();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    updateButton();
  });
  standalone.addEventListener?.('change', updateButton);
  button.addEventListener('click', async () => {
    const prompt = installPrompt;
    installPrompt = null;
    if (prompt) {
      try {
        await prompt.prompt();
        return;
      } catch {
        // 브라우저의 설치 창을 열 수 없으면 메뉴에서 설치하는 방법을 안내한다.
      }
    }
    if (!dialog.open) dialog.showModal();
  });
  updateButton();

  if (window.isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.warn('오프라인 안내를 준비하지 못했습니다.', error);
    });
  }
})();
