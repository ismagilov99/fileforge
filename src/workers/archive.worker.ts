import { createArchive, type ArchiveItem } from '../engines/archive';

interface CreateRequest {
  id: string;
  type: 'create';
  files: ArchiveItem[];
  folders: string[];
}
interface CancelRequest {
  id: string;
  type: 'cancel';
}
type Request = CreateRequest | CancelRequest;

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
  void createArchive(request.files, request.folders, controller.signal, (progress) => {
    workerScope.postMessage({ id: request.id, type: 'progress', progress: progress.percent });
  })
    .then((blob) => {
      if (controller.signal.aborted) throw new DOMException('Операция отменена.', 'AbortError');
      workerScope.postMessage({ id: request.id, type: 'complete', result: blob });
    })
    .catch((error: unknown) => {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      workerScope.postMessage({
        id: request.id,
        type: aborted ? 'cancelled' : 'failure',
        message: error instanceof Error ? error.message : 'Неизвестная ошибка создания архива.',
      });
    })
    .finally(() => controllers.delete(request.id));
});
