import { clearHistory, saveHistory, type HistoryEntry } from '../core/history';
import { formatBytes } from '../core/validation';
import { state } from './state';
import { $, toast } from './dom';

export function saveOperation(
  operation: HistoryEntry['operation'],
  filename: string,
  format: string,
  bytes: number,
  itemCount?: number,
): void {
  state.history = saveHistory({ operation, filename, format, bytes, itemCount });
  renderHistory();
}

export function renderHistory(): void {
  const target = $('historyList');
  target.replaceChildren();
  $('historyCount').textContent = String(state.history.length);
  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'История пока пуста.';
    target.append(empty);
    return;
  }

  for (const item of state.history) {
    const row = document.createElement('div');
    row.className = 'history-row';
    const details = document.createElement('div');
    details.className = 'history-row-main';
    const name = document.createElement('strong');
    name.textContent = item.filename;
    const meta = document.createElement('span');
    meta.textContent = `${item.operation.toUpperCase()} · ${item.format} · ${formatBytes(item.bytes)}${item.itemCount ? ` · ${item.itemCount} шт.` : ''}`;
    details.append(name, meta);
    const date = document.createElement('time');
    date.dateTime = new Date(item.timestamp).toISOString();
    date.textContent = new Date(item.timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    row.append(details, date);
    target.append(row);
  }
}

export function initHistory(): void {
  renderHistory();
  $('historyClear').addEventListener('click', () => {
    clearHistory();
    state.history = [];
    renderHistory();
    toast('История операций очищена.', 'success');
  });
}
