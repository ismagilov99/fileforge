export class FileForgeError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, options?: ErrorOptions) {
    super(userMessage, options);
    this.name = 'FileForgeError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof FileForgeError) return error.userMessage;
  if (error instanceof DOMException && error.name === 'AbortError') return 'Операция отменена.';
  if (error instanceof Error) return error.message || 'Не удалось выполнить операцию.';
  return 'Произошла непредвиденная ошибка. Попробуйте ещё раз.';
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
