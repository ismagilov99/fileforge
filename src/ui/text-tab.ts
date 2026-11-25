import { LIMITS, type TextFormat } from '../core/config';
import { measureText, validateTextBytes, formatBytes } from '../core/validation';
import { downloadBlob } from '../core/download';
import { toUserMessage, isAbortError } from '../core/errors';
import { exportTextInWorker } from '../engines/background';
import { state } from './state';
import { $, getOutputName, setIndeterminateProgress, resetProgress, setupNamePreview, toast } from './dom';
import { beginOperation, finishOperation, isBusy } from './operation';
import { saveOperation } from './history-panel';

let textInfoTimer: number | null = null;
const TEXT_INFO_DEBOUNCE_MS = 220;

const TEXT_HINTS: Record<TextFormat, string> = {
  txt: 'TXT сохраняет только введённый текст: пробелы, пустые строки и переносы не удаляются.',
  md: 'Markdown сохраняет только введённый текст. Заголовки и метаданные не добавляются.',
  html: 'HTML содержит необходимую структуру страницы. Твой текст отображается как текст, а не исполняется как HTML.',
  json: 'JSON сохраняет всё содержимое как одну JSON-строку без дополнительных полей.',
  csv: 'Важно: Excel и другие табличные редакторы могут интерпретировать значения, начинающиеся с =, +, - или @, как формулы. FileForge сохраняет исходный текст без изменений и не добавляет защитный апостроф. Не открывай непроверенный CSV в табличном редакторе.',
  xml: 'XML помещает содержимое в корневой элемент document. Запрещённые XML 1.0 символы отклоняются, а не удаляются.',
};

function updateTextInfo(): void {
  if (textInfoTimer !== null) {
    window.clearTimeout(textInfoTimer);
    textInfoTimer = null;
  }
  const input = $('textInput') as HTMLTextAreaElement;
  const metrics = measureText(input.value);
  const overLimit = metrics.bytes > LIMITS.text.maxBytes;
  const invalidUnicode = !metrics.wellFormed;
  $('textStats').textContent =
    `${metrics.codePoints.toLocaleString('ru-RU')} символов · ${formatBytes(metrics.bytes)}`;
  const format = ($('textFormat') as HTMLSelectElement).value as TextFormat;
  const hint = $('textFormatHint');
  hint.textContent = invalidUnicode
    ? 'В тексте обнаружена некорректная Unicode-последовательность. FileForge не заменит её автоматически; исправь символ перед экспортом.'
    : TEXT_HINTS[format];
  hint.classList.toggle('hint-warning', format === 'csv' || invalidUnicode);
  hint.setAttribute('role', 'note');
  $('textRun').textContent = `Скачать ${format.toUpperCase()}`;
  $('textRun').toggleAttribute('disabled', overLimit || invalidUnicode || isBusy());
  input.setAttribute('aria-invalid', String(overLimit || invalidUnicode));
  if (overLimit) {
    $('textStats').textContent += ` · превышен лимит ${formatBytes(LIMITS.text.maxBytes)}`;
  } else if (invalidUnicode) {
    $('textStats').textContent += ' · некорректный Unicode';
  }
}

async function runTextExport(): Promise<void> {
  const text = ($('textInput') as HTMLTextAreaElement).value;
  try {
    validateTextBytes(text);
  } catch (error) {
    toast(toUserMessage(error), 'error');
    return;
  }
  if (!beginOperation('text')) return;
  const controller = new AbortController();
  state.activeAbort = controller;
  try {
    const format = ($('textFormat') as HTMLSelectElement).value as TextFormat;
    const filename = getOutputName('textOutputName', 'fileforge-text', format);
    $('textCancel').hidden = false;
    setIndeterminateProgress('text', 'Создание файла в фоновом потоке…');
    const result = await exportTextInWorker(text, format, controller.signal);
    if (!(result.blob instanceof Blob) || result.extension !== format || result.blob.type !== result.mime) {
      throw new Error('Фоновый обработчик вернул результат с некорректным типом или расширением.');
    }
    downloadBlob(result.blob, filename);
    saveOperation('text', filename, format.toUpperCase(), result.blob.size, 1);
    toast(`Файл ${filename} подготовлен.`, 'success');
  } catch (error) {
    if (isAbortError(error)) toast('Создание файла отменено.', 'warning');
    else toast(toUserMessage(error), 'error');
  } finally {
    $('textCancel').hidden = true;
    finishOperation('text');
    window.setTimeout(() => resetProgress('text'), 1200);
    updateTextInfo();
  }
}

function scheduleTextInfoUpdate(): void {
  if (textInfoTimer !== null) window.clearTimeout(textInfoTimer);
  textInfoTimer = window.setTimeout(() => {
    textInfoTimer = null;
    updateTextInfo();
  }, TEXT_INFO_DEBOUNCE_MS);
}

export function initText(): void {
  $('textInput').addEventListener('input', scheduleTextInfoUpdate);
  $('textFormat').addEventListener('change', updateTextInfo);
  $('textClear').addEventListener('click', () => {
    ($('textInput') as HTMLTextAreaElement).value = '';
    updateTextInfo();
  });
  $('textRun').addEventListener('click', () => void runTextExport());
  $('textCancel').addEventListener('click', () => state.activeAbort?.abort());
  setupNamePreview(
    'textOutputName',
    'textOutputPreview',
    'fileforge-text',
    () => ($('textFormat') as HTMLSelectElement).value,
    ['textFormat'],
  );
  updateTextInfo();
}
