import { describe, it, expect } from 'vitest';
import { clients } from './clients.js';
import { staff } from './staff.js';

describe('Soft-delete schema', () => {
  it('clients table has a nullable deletedAt column', () => {
    const col = clients.deletedAt;
    expect(col).toBeDefined();
    expect(col.notNull).toBe(false);
  });

  it('staff table has a nullable deletedAt column', () => {
    const col = staff.deletedAt;
    expect(col).toBeDefined();
    expect(col.notNull).toBe(false);
  });
});
