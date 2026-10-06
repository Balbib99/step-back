import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@step-back/shared';

describe('workspace wiring', () => {
  it('lets the server import from @step-back/shared', () => {
    expect(APP_NAME).toBe('step-back');
  });
});
