import { describe, expect, it } from 'vitest';
import { formatDisplayPath, getPathFileName } from './path-display';

const extendedDrivePath = String.raw`\\?\D:\Qoder\azure\README.md`;
const standardDrivePath = String.raw`D:\Qoder\azure\README.md`;

describe('formatDisplayPath', () => {
  it('removes the Windows extended-length prefix from local drive paths', () => {
    expect(formatDisplayPath(extendedDrivePath)).toBe(standardDrivePath);
  });

  it('renders extended UNC paths in standard UNC notation', () => {
    expect(formatDisplayPath(String.raw`\\?\UNC\server\share\README.md`)).toBe(String.raw`\\server\share\README.md`);
  });

  it('does not change normal paths', () => {
    expect(formatDisplayPath(standardDrivePath)).toBe(standardDrivePath);
  });
});

describe('getPathFileName', () => {
  it('extracts a concise file name from Windows extended-length paths', () => {
    expect(getPathFileName(extendedDrivePath)).toBe('README.md');
  });

  it('accepts Unix-style paths too', () => {
    expect(getPathFileName('/home/user/docs/guide.markdown')).toBe('guide.markdown');
  });
});
