import { createId } from './ids';
import { FileForgeError } from './errors';

interface WorkerEnvelope {
  id?: string;
  type?: string;
  message?: string;
  progress?: number;
  result?: unknown;
}

export interface WorkerProgress {
  percent: number;
  label?: string;
  detail?: string;
}

export function requestWorker<T>(
  createWorker: () => Worker,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onProgress?: (progress: WorkerProgress) => void,
  timeoutMs = 10 * 60 * 1000,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Операция отменена.', 'AbortError'));
  if (typeof Worker === 'undefined') {
    return Promise.reject(
      new FileForgeError(
        'WORKER_UNAVAILABLE',
        'Этот браузер не поддерживает фоновую обработку. Обнови браузер.',
      ),
    );
  }

  return new Promise<T>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Не удалось запустить фоновую обработку.'));
      return;
    }

    const id = createId('worker');
    let settled = false;
    const timer = window.setTimeout(() => {
      finish(() =>
        reject(
          new FileForgeError('WORKER_TIMEOUT', 'Операция заняла слишком много времени и была остановлена.'),
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      worker.terminate();
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        callback();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Ошибка завершения фоновой операции.'));
      }
    };

    const abort = () => {
      try {
        worker.postMessage({ type: 'cancel', id });
      } catch {
        /* Worker may already have stopped. */
      }
      finish(() => reject(new DOMException('Операция отменена.', 'AbortError')));
    };

    const onError = (event: ErrorEvent) => {
      finish(() =>
        reject(new Error(`Фоновый обработчик остановился: ${event.message || 'неизвестная ошибка'}`)),
      );
    };

    const onMessageError = () => {
      finish(() => reject(new Error('Не удалось прочитать ответ фонового обработчика.')));
    };

    const onMessage = (event: MessageEvent<WorkerEnvelope>) => {
      const message = event.data;
      if (!message || message.id !== id || typeof message.type !== 'string') return;
      if (message.type === 'progress') {
        try {
          const percent = Number.isFinite(message.progress)
            ? Math.min(100, Math.max(0, message.progress!))
            : 0;
          onProgress?.({ percent });
        } catch (error) {
          finish(() =>
            reject(error instanceof Error ? error : new Error('Ошибка обработки уведомления о прогрессе.')),
          );
        }
      } else if (message.type === 'complete') {
        finish(() => resolve(message.result as T));
      } else if (message.type === 'failure') {
        finish(() => reject(new Error(message.message || 'Фоновая операция завершилась ошибкой.')));
      } else if (message.type === 'cancelled') {
        finish(() => reject(new DOMException('Операция отменена.', 'AbortError')));
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    signal.addEventListener('abort', abort, { once: true });

    try {
      worker.postMessage({ ...payload, id });
    } catch (error) {
      finish(() =>
        reject(
          error instanceof Error ? error : new Error('Не удалось передать данные фоновому обработчику.'),
        ),
      );
    }
  });
}
