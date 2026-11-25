import type { MergeFormat, TextFormat } from '../core/config';
import { convertText, mergeTextFiles, type MergeInput } from '../engines/text';

interface TextRequest {
  id: string;
  type: 'text';
  text: string;
  format: TextFormat;
}
interface MergeRequest {
  id: string;
  type: 'merge';
  files: MergeInput[];
  format: MergeFormat;
  includeNames: boolean;
}
interface CancelRequest {
  id: string;
  type: 'cancel';
}
type Request = TextRequest | MergeRequest | CancelRequest;

const cancelled = new Set<string>();
const workerScope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
};

async function run(request: TextRequest | MergeRequest): Promise<void> {
  if (cancelled.has(request.id)) throw new DOMException('Операция отменена.', 'AbortError');
  const result =
    request.type === 'text'
      ? convertText(request.text, request.format)
      : mergeTextFiles(request.files, request.format, request.includeNames);
  if (cancelled.has(request.id)) throw new DOMException('Операция отменена.', 'AbortError');
  workerScope.postMessage({ id: request.id, type: 'complete', result });
}

workerScope.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled.add(request.id);
    return;
  }
  cancelled.delete(request.id);
  void run(request)
    .catch((error: unknown) => {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      workerScope.postMessage({
        id: request.id,
        type: aborted ? 'cancelled' : 'failure',
        message: error instanceof Error ? error.message : 'Неизвестная ошибка обработки.',
      });
    })
    .finally(() => cancelled.delete(request.id));
});
