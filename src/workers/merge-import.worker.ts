import { prepareMergeBatch } from '../engines/merge';
import type { MergePreparationResult } from '../engines/merge';

interface PrepareRequest {
  id: string;
  type: 'prepare';
  files: File[];
}
interface CancelRequest {
  id: string;
  type: 'cancel';
}
type Request = PrepareRequest | CancelRequest;

const controllers = new Map<string, AbortController>();
const workerScope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
};

workerScope.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controllers.get(request.id)?.abort();
    return;
  }

  const controller = new AbortController();
  controllers.set(request.id, controller);
  void prepareMergeBatch(request.files, controller.signal)
    .then((result: MergePreparationResult) => {
      if (controller.signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
      workerScope.postMessage({ id: request.id, type: 'complete', result });
    })
    .catch((error: unknown) => {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      workerScope.postMessage({
        id: request.id,
        type: aborted ? 'cancelled' : 'failure',
        message: error instanceof Error ? error.message : 'Не удалось проверить файлы.',
      });
    })
    .finally(() => controllers.delete(request.id));
});
