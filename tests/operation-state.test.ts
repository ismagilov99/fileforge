import { describe, expect, it } from 'vitest';
import { hasActiveWork } from '../src/core/operation-state';

describe('global operation activity', () => {
  it('is idle only when no operation or preparation is running', () => {
    expect(hasActiveWork({ activeOperation: null, imagePreparing: false, mergePreparing: false })).toBe(
      false,
    );
  });

  it('blocks a new operation while an image batch is being prepared', () => {
    expect(hasActiveWork({ activeOperation: null, imagePreparing: true, mergePreparing: false })).toBe(true);
  });

  it('blocks a new operation while a merge or ZIP batch is being prepared', () => {
    expect(hasActiveWork({ activeOperation: null, imagePreparing: false, mergePreparing: true })).toBe(true);
  });

  it('blocks a new preparation while another major operation is running', () => {
    expect(hasActiveWork({ activeOperation: 'archive', imagePreparing: false, mergePreparing: false })).toBe(
      true,
    );
  });
});
