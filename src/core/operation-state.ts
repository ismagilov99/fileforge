/** Minimal state shape used to serialize CPU- and memory-intensive workflows. */
export interface OperationActivity {
  activeOperation: string | null;
  imagePreparing: boolean;
  mergePreparing: boolean;
}

/**
 * Preparation workers count as active work too. This prevents a second workflow
 * from starting while image hashing or ZIP/text import is still consuming memory.
 */
export function hasActiveWork(activity: OperationActivity): boolean {
  return activity.activeOperation !== null || activity.imagePreparing || activity.mergePreparing;
}
