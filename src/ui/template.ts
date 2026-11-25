import { LIMITS } from '../core/config';
import { formatBytes } from '../core/validation';

/** Static application shell. User-controlled data is rendered with DOM APIs, never interpolated here. */
export const APP_TEMPLATE = `
  <a class="skip-link" href="#appMain">Перейти к инструментам</a>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#top">
        <span class="brand-mark" aria-hidden="true">F</span>
        <span>FileForge</span>
      </a>
      <div class="topbar-actions">
        <span class="privacy-chip"><span class="privacy-dot"></span>Обработка в браузере</span>
        <label class="theme-control"><span class="sr-only">Тема интерфейса</span><select id="themeSelect" aria-label="Тема интерфейса"><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="space">Орбитальная</option></select></label>
      </div>
    </header>

    <main id="appMain" tabindex="-1">
      <section class="intro" id="top">
        <p class="eyebrow">ЛОКАЛЬНЫЕ ИНСТРУМЕНТЫ</p>
        <h1>Работа с файлами</h1>
        <p class="intro-copy">Конвертируй изображения, сохраняй текст, собирай архивы и объединяй документы. Содержимое файлов обрабатывается в браузере и не загружается на сервер FileForge.</p>
      </section>

      <div class="task-status" id="globalTaskStatus" role="status" aria-live="polite" hidden>
        <span class="task-status-indicator" aria-hidden="true"></span>
        <span id="globalTaskStatusText">Выполняется операция…</span>
      </div>
      <nav class="tabs" role="tablist" aria-label="Инструменты" aria-orientation="horizontal">
        <button class="tab active" id="tab-images" data-tab="images" role="tab" aria-selected="true" aria-controls="panel-images">Изображения</button>
        <button class="tab" id="tab-text" data-tab="text" role="tab" aria-selected="false" aria-controls="panel-text" tabindex="-1">Текст в файл</button>
        <button class="tab" id="tab-archive" data-tab="archive" role="tab" aria-selected="false" aria-controls="panel-archive" tabindex="-1">Архиватор</button>
        <button class="tab" id="tab-merge" data-tab="merge" role="tab" aria-selected="false" aria-controls="panel-merge" tabindex="-1">Объединение</button>
      </nav>

      <section class="panel active" id="panel-images" role="tabpanel" aria-labelledby="tab-images" tabindex="0">
        <div class="panel-heading"><div><p class="eyebrow">01 / КОНВЕРТЕР</p><h2>Преобразование изображений</h2><p>Добавь изображения, выбери формат — остальные настройки можно не трогать.</p></div></div>
        <label class="dropzone" id="imageDrop" for="imageFiles">
          <input id="imageFiles" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg" multiple />
          <span class="drop-icon" aria-hidden="true">↥</span><strong>Перетащи изображения сюда</strong><span>или нажми, чтобы выбрать файлы</span>
          <small>PNG, JPG, WebP, GIF, BMP, SVG · до ${LIMITS.image.maxFiles} файлов · ${formatBytes(LIMITS.image.maxFileBytes)} на файл · ${formatBytes(LIMITS.image.maxTotalBytes)} суммарно · до ${LIMITS.image.maxPixels.toLocaleString('ru-RU')} пикселей на изображение</small>
        </label>
        <div class="section-row"><div><h3>Файлы</h3><p class="muted" id="imageCount">Пока ничего не добавлено</p></div><div class="inline-actions"><button class="text-button danger-text" id="imagePrepareCancel" type="button" hidden>Отменить проверку</button><button class="text-button" id="imageClear" type="button" disabled>Очистить</button></div></div>
        <div class="file-list" id="imageList" aria-live="polite"></div>
        <div class="notice result-notice" id="imageFailures" role="status" aria-live="polite" hidden></div>
        <div class="settings-card" id="imageSettings" hidden>
          <div class="field-grid">
            <label class="field"><span>Формат результата</span><select id="imageFormat"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
            <label class="field"><span>Имя ZIP-файла <em>необязательно</em></span><input id="imageOutputName" type="text" maxlength="140" placeholder="Оставь пустым — имя будет создано автоматически" autocomplete="off" aria-describedby="imageOutputPreview" />
              <small class="name-preview" id="imageOutputPreview">Имя будет подобрано автоматически.</small></label>
          </div>
          <details class="advanced" id="imageAdvanced"><summary>Дополнительные настройки</summary>
            <div class="advanced-content"><label class="field" id="qualityField"><span>Качество JPEG / WebP <output id="qualityValue">92%</output></span><input id="imageQuality" type="range" min="10" max="100" value="92" /></label>
            <p class="hint">PNG и WebP сохраняют прозрачность. Для JPEG прозрачные области заменяются белым цветом. Анимированные GIF/WebP преобразуются в статичное изображение одного кадра.</p></div>
          </details>
          <div class="action-row"><button class="primary-button" id="imageRun" type="button" disabled>Конвертировать и скачать ZIP</button><button class="secondary-button danger" id="imageCancel" type="button" data-operation-cancel hidden>Отменить</button></div>
          <div class="progress-wrap" id="imageProgress" hidden><div class="progress-head"><span id="imageProgressLabel">Подготовка…</span><span id="imageProgressValue">0%</span></div><div class="progress-track" role="progressbar" aria-label="Обработка изображений" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="imageProgressTrack"><div class="progress-bar" id="imageProgressBar"></div></div><p class="hint" id="imageProgressDetail" aria-live="polite"></p></div>
        </div>
      </section>

      <section class="panel" id="panel-text" role="tabpanel" aria-labelledby="tab-text" tabindex="0" hidden>
        <div class="panel-heading"><div><p class="eyebrow">02 / ТЕКСТ</p><h2>Текст в файл</h2><p>Введённое содержимое не дополняется датой, подписью FileForge или статистикой.</p></div></div>
        <label class="field editor-field"><span>Содержимое</span><textarea id="textInput" spellcheck="false" placeholder="Введи или вставь текст…" aria-describedby="textStats textLimitHint textFormatHint"></textarea></label>
        <div class="editor-meta"><span id="textStats">0 символов · 0 Б</span><button class="text-button" id="textClear" type="button">Очистить текст</button></div><p class="hint" id="textLimitHint">Лимит ввода: ${formatBytes(LIMITS.text.maxBytes)} UTF-8. Пустой файл разрешён.</p>
        <div class="settings-card">
          <div class="field-grid">
            <label class="field"><span>Формат</span><select id="textFormat"><option value="txt">TXT — исходный текст без изменений</option><option value="md">Markdown — исходный текст без изменений</option><option value="html">HTML — текст в простой странице</option><option value="json">JSON — строка JSON</option><option value="csv">CSV — одна ячейка с текстом</option><option value="xml">XML — содержимое элемента document</option></select></label>
            <label class="field"><span>Имя файла <em>необязательно</em></span><input id="textOutputName" type="text" maxlength="140" placeholder="Оставь пустым — имя будет создано автоматически" autocomplete="off" aria-describedby="textOutputPreview" />
              <small class="name-preview" id="textOutputPreview">Имя будет подобрано автоматически.</small></label>
          </div>
          <p class="hint" id="textFormatHint">TXT содержит ровно введённый текст, включая пробелы и переносы строк.</p>
          <div class="action-row"><button class="primary-button" id="textRun" type="button">Скачать TXT</button><button class="secondary-button danger" id="textCancel" type="button" data-operation-cancel hidden>Отменить</button></div>
          <div class="progress-wrap" id="textProgress" hidden><div class="progress-head"><span id="textProgressLabel">Создание файла…</span><span id="textProgressValue">…</span></div><div class="progress-track" role="progressbar" aria-label="Создание текстового файла" aria-valuemin="0" aria-valuemax="100" id="textProgressTrack"><div class="progress-bar indeterminate" id="textProgressBar"></div></div></div>
        </div>
      </section>

      <section class="panel" id="panel-archive" role="tabpanel" aria-labelledby="tab-archive" tabindex="0" hidden>
        <div class="panel-heading"><div><p class="eyebrow">03 / АРХИВ</p><h2>Создание ZIP-архива</h2><p>Добавь любые файлы, при необходимости разложи их по папкам.</p></div></div>
        <label class="dropzone" id="archiveDrop" for="archiveFiles"><input id="archiveFiles" type="file" multiple /><span class="drop-icon" aria-hidden="true">▤</span><strong>Перетащи файлы сюда</strong><span>или нажми, чтобы выбрать</span><small>До ${LIMITS.archive.maxFiles} файлов · ${formatBytes(LIMITS.archive.maxFileBytes)} на файл · ${formatBytes(LIMITS.archive.maxTotalBytes)} суммарно · итоговый ZIP до ${formatBytes(LIMITS.archive.maxOutputBytes)}</small></label>
        <div class="section-row"><div><h3>Содержимое архива</h3><p class="muted" id="archiveStats">Пока ничего не добавлено</p></div><div class="inline-actions"><button class="text-button" id="archiveSort" type="button" disabled>Автораскладка</button><button class="text-button danger-text" id="archiveClear" type="button" disabled>Очистить</button></div></div>
        <div class="archive-tools" id="archiveTools" hidden><form id="folderForm" class="folder-form"><label class="sr-only" for="folderName">Новая папка</label><input id="folderName" type="text" maxlength="40" placeholder="Название папки" /><button class="secondary-button" type="submit">Добавить папку</button></form><p class="hint">Папку можно назначить каждому файлу. Созданные пустые папки также попадут в ZIP.</p></div>
        <div class="file-list" id="archiveList" aria-live="polite"></div>
        <div class="settings-card" id="archiveSettings" hidden><label class="field"><span>Имя ZIP-файла <em>необязательно</em></span><input id="archiveOutputName" type="text" maxlength="140" placeholder="Оставь пустым — имя будет создано автоматически" autocomplete="off" aria-describedby="archiveOutputPreview" />
            <small class="name-preview" id="archiveOutputPreview">Имя будет подобрано автоматически.</small></label><div class="action-row"><button class="primary-button" id="archiveRun" type="button">Создать и скачать ZIP</button><button class="secondary-button danger" id="archiveCancel" type="button" data-operation-cancel hidden>Отменить</button></div><div class="progress-wrap" id="archiveProgress" hidden><div class="progress-head"><span id="archiveProgressLabel">Упаковка…</span><span id="archiveProgressValue">0%</span></div><div class="progress-track" role="progressbar" aria-label="Создание ZIP-архива" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="archiveProgressTrack"><div class="progress-bar" id="archiveProgressBar"></div></div></div></div>
      </section>

      <section class="panel" id="panel-merge" role="tabpanel" aria-labelledby="tab-merge" tabindex="0" hidden>
        <div class="panel-heading"><div><p class="eyebrow">04 / ОБЪЕДИНЕНИЕ</p><h2>Объединение текстовых файлов</h2><p>Добавляй отдельные документы или ZIP. Порядок файлов можно менять.</p></div></div>
        <label class="dropzone" id="mergeDrop" for="mergeFiles"><input id="mergeFiles" type="file" multiple accept=".txt,.md,.markdown,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.html,.htm,.css,.scss,.json,.jsonl,.csv,.tsv,.xml,.sql,.sh,.bash,.yaml,.yml,.toml,.ini,.log,.rb,.go,.rs,.java,.php,.c,.cpp,.h,.hpp,.swift,.kt,.kts,.bat,.ps1,.conf,.env,.gitignore,.dockerfile,.makefile,.vue,.svelte,.graphql,.gql,.proto,.diff,.patch,.zip" /><span class="drop-icon" aria-hidden="true">⇄</span><strong>Перетащи текстовые файлы или ZIP</strong><span>или нажми, чтобы выбрать</span><small>До ${LIMITS.merge.maxFiles} файлов · суммарно до ${formatBytes(LIMITS.merge.maxTotalInputBytes)} · один ZIP до ${formatBytes(LIMITS.merge.maxZipBytes)} · одна запись до ${formatBytes(LIMITS.merge.maxEntryBytes)} · распакованный текст до ${formatBytes(LIMITS.merge.maxTotalUncompressedBytes)}</small></label>
        <div class="section-row"><div><h3>Порядок объединения</h3><p class="muted" id="mergeStats">Пока ничего не добавлено</p></div><div class="inline-actions"><button class="text-button danger-text" id="mergePrepareCancel" type="button" hidden>Отменить проверку</button><button class="text-button danger-text" id="mergeClear" type="button" disabled>Очистить</button></div></div>
        <div class="file-list" id="mergeList" aria-live="polite"></div>
        <div class="notice" id="mergeSkipped" role="status" aria-live="polite" hidden></div>
        <div class="settings-card" id="mergeSettings" hidden>
          <div class="field-grid"><label class="field"><span>Формат результата</span><select id="mergeFormat"><option value="txt">TXT</option><option value="md">Markdown</option><option value="html">HTML</option><option value="json">JSON</option></select></label><label class="field"><span>Имя файла <em>необязательно</em></span><input id="mergeOutputName" type="text" maxlength="140" placeholder="Оставь пустым — имя будет создано автоматически" autocomplete="off" aria-describedby="mergeOutputPreview" />
            <small class="name-preview" id="mergeOutputPreview">Имя будет подобрано автоматически.</small></label></div>
          <label class="check-field"><input id="mergeIncludeNames" type="checkbox" /><span>Добавлять имена исходных файлов в результат</span></label>
          <div class="action-row"><button class="primary-button" id="mergeRun" type="button">Объединить и скачать</button><button class="secondary-button danger" id="mergeCancel" type="button" data-operation-cancel hidden>Отменить</button></div>
          <div class="progress-wrap" id="mergeProgress" hidden><div class="progress-head"><span id="mergeProgressLabel">Объединение…</span><span id="mergeProgressValue">…</span></div><div class="progress-track" role="progressbar" aria-label="Объединение файлов" aria-valuemin="0" aria-valuemax="100" id="mergeProgressTrack"><div class="progress-bar indeterminate" id="mergeProgressBar"></div></div></div>
        </div>
      </section>

      <section class="history-section">
        <details id="historyDetails"><summary>Недавние операции <span class="muted" id="historyCount">0</span></summary><div class="history-toolbar"><p class="hint">История хранит только имена результатов, формат, размер и время. Содержимое файлов не сохраняется.</p><button class="text-button danger-text" id="historyClear" type="button">Очистить историю</button></div><div id="historyList" class="history-list"></div></details>
      </section>
    <section class="faq-section" aria-labelledby="faqTitle">
        <h2 id="faqTitle">Частые вопросы</h2>
        <div class="faq-list">
          <details class="faq-item"><summary>Что делает вкладка «Изображения»?</summary><p>Конвертирует PNG, JPG, WebP, GIF, BMP и SVG в PNG, JPEG или WebP и упаковывает результат в ZIP. Формат и качество можно выбрать, а можно ничего не менять — всё сработает автоматически. Анимация GIF/WebP не сохраняется: получается один статичный кадр.</p></details>
          <details class="faq-item"><summary>Что делает «Текст в файл»?</summary><p>Сохраняет введённый текст как TXT, Markdown, HTML, JSON, CSV или XML. TXT и Markdown содержат ровно твой текст — без дат, подписей и статистики. Остальные форматы добавляют только обязательную синтаксическую оболочку.</p></details>
          <details class="faq-item"><summary>Что делает «Архиватор»?</summary><p>Собирает любые файлы в обычный ZIP-архив. Можно создать папки, разложить файлы вручную или нажать «Автораскладка» — файлы распределятся по категориям. Пустые папки тоже попадают в архив.</p></details>
          <details class="faq-item"><summary>Что делает «Объединение»?</summary><p>Склеивает текстовые файлы (TXT, MD, код и другие) и текстовые записи из ZIP в один документ: TXT, Markdown, HTML или JSON. Порядок файлов можно менять стрелками, а имена исходных файлов добавляются в результат по желанию.</p></details>
        </div>
        <p class="hint">Все операции выполняются в браузере: файлы не отправляются на сервер и остаются на устройстве.</p>
      </section>
    </main>
    <footer class="footer"><span>FileForge</span><span>Файлы остаются на устройстве</span></footer>
  </div>
  <div class="download-fallbacks" id="downloadFallbacks" role="region" aria-label="Последние файлы для скачивания" aria-live="polite"></div>
  <div class="toast-region" id="toastRegion" role="region" aria-label="Уведомления" aria-live="polite" aria-atomic="false"></div>
`;
