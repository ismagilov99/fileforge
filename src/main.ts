import './style.css';
import { APP_TEMPLATE } from './ui/template';
import { toast } from './ui/dom';
import { setupTabs } from './ui/tabs';
import { setupTheme } from './ui/theme';
import { initImages, revokeImagePreviews } from './ui/images-tab';
import { initText } from './ui/text-tab';
import { initArchive } from './ui/archive-tab';
import { initMerge } from './ui/merge-tab';
import { initHistory } from './ui/history-panel';
import { cancelCurrentOperation } from './ui/operation';
import { revokeDownloads } from './core/download';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не найден корневой элемент приложения.');

// GitHub Pages cannot attach frame-ancestors as a response header. Refuse to
// initialize when embedded; this is defense in depth, not a substitute for X-Frame-Options.
if (window.top !== window.self) {
  app.textContent = 'FileForge нельзя открыть внутри встроенного окна. Открой сайт в отдельной вкладке.';
  throw new Error('FileForge refuses to initialize inside a frame.');
}

// The template is static. Every user-controlled string is inserted later via
// textContent, form values or typed Blob data — never interpolated into HTML.
app.innerHTML = APP_TEMPLATE;

setupTabs();
setupTheme();
initImages();
initText();
initArchive();
initMerge();
initHistory();

window.addEventListener('unhandledrejection', (event) => {
  console.error('[FileForge] Unhandled promise rejection:', event.reason);
  toast('Произошла непредвиденная ошибка. Подробности доступны в консоли разработчика.', 'error');
});

window.addEventListener('error', (event) => {
  console.error('[FileForge] Runtime error:', event.error ?? event.message);
});

window.addEventListener('beforeunload', () => {
  revokeImagePreviews();
  revokeDownloads();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') cancelCurrentOperation();
});
