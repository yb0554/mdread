import { describe, expect, it } from 'vitest';
import { formatDisplayPath } from './path-display';

describe('formatDisplayPath', () => {
  it('removes the Windows extended-length prefix from local drive paths', () => {
    expect(formatDisplayPath('\\\\?\\D:\\Qoder\\azure\\README.md')).toBe('D:\\Qoder\\azure\\README.md');
  });

  it('renders extended UNC paths in standard UNC notation', () => {
    expect(formatDisplayPath('\\\\?\\UNC\\server\\share\\README.md')).toBe('\\\\server\\share\\README.md');
  });

  it('does not change normal paths', () => {
    expect(formatDisplayPath('D:\\Qoder\\azure\\README.md')).toBe('D:\\Qoder\\azure\\README.md');
  });
});
