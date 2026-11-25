import { toast, setBusyStatus } from './dom';
import { state, type OperationKind } from './state';
import { hasActiveWork } from '../core/operation-state';

const previousDisabled = new WeakMap<
  HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  boolean
>();

function lockPanelControls(locked: boolean): void {
  const controls = document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('.panel button:not([data-operation-cancel]), .panel input, .panel select, .panel textarea');
  for (const control of controls) {
    if (locked) {
      if (!previousDisabled.has(control)) previousDisabled.set(control, control.disabled);
      control.disabled = true;
    } else {
      const wasDisabled = previousDisabled.get(control);
      if (wasDisabled !== undefined) control.disabled = wasDisabled;
      previousDisabled.delete(control);
    }
  }
}

export function beginOperation(kind: OperationKind): boolean {
  if (hasActiveWork(state)) {
    toast('Сначала дождись завершения текущей операции или отмени её.', 'warning');
    return false;
  }
  state.activeOperation = kind;
  setBusyStatus(kind);
  lockPanelControls(true);
  document.documentElement.dataset['operation'] = kind;
  return true;
}

export function finishOperation(kind: OperationKind): void {
  if (state.activeOperation !== kind) return;
  state.activeOperation = null;
  state.activeAbort = null;
  delete document.documentElement.dataset['operation'];
  lockPanelControls(false);
  setBusyStatus(null);
  window.dispatchEvent(new CustomEvent('fileforge:idle'));
}

export function isBusy(): boolean {
  return hasActiveWork(state);
}

export function cancelCurrentOperation(): void {
  state.activeAbort?.abort();
  state.imagePrepareAbort?.abort();
  state.mergePrepareAbort?.abort();
}
