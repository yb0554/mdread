import { describe, expect, it } from 'vitest';
import { toAppError } from './types';

describe('structured IPC error conversion', () => {
  it('preserves a native structured error', () => {
    expect(toAppError({ code: 'NOT_AUTHORIZED', message: '工作区未授权' })).toEqual({
      code: 'NOT_AUTHORIZED',
      message: '工作区未授权',
    });
  });

  it('parses structured errors serialized by IPC', () => {
    expect(toAppError('{"code":"FILE_TOO_LARGE","message":"需要确认","byteSize":26214400}')).toEqual({
      code: 'FILE_TOO_LARGE',
      message: '需要确认',
      byteSize: 26214400,
    });
  });

  it('maps unknown failures to a displayable I/O error', () => {
    expect(toAppError(new Error('read failed'))).toEqual({
      code: 'IO_ERROR',
      message: 'read failed',
    });
  });
});
