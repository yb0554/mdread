export interface DocumentRef {
  workspaceId?: string;
  documentId?: string;
  relativePath?: string;
}

export interface DocumentPayload {
  documentRef: DocumentRef;
  name: string;
  content: string;
  encoding: 'utf-8' | 'gbk' | string;
  byteSize: number;
  modifiedAt: number;
  warnings: string[];
}

export interface WorkspaceDescriptor {
  id: string;
  path: string;
  name: string;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  isDir: boolean;
  extension: string | null;
}

export interface SearchResult {
  documentRef: DocumentRef;
  name: string;
  relativePath: string;
  matchKind: 'filename' | 'content' | string;
  snippet?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  cancelled: boolean;
}

export interface AppError {
  code: 'NOT_AUTHORIZED' | 'NOT_FOUND' | 'UNSUPPORTED_ENCODING' | 'FILE_TOO_LARGE' | 'IO_ERROR' | 'INTERNAL_ERROR' | string;
  message: string;
  byteSize?: number;
}

export interface FileSelection {
  documentRef: DocumentRef;
  absolutePath: string;
}

function isAppError(value: unknown): value is AppError {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'message' in value
    && typeof (value as AppError).code === 'string'
    && typeof (value as AppError).message === 'string';
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return toAppError((error as { message: unknown }).message);
  }
  if (typeof error === 'string') {
    try {
      const parsed: unknown = JSON.parse(error);
      if (isAppError(parsed)) return parsed;
    } catch {
      // The native bridge can already provide a readable error string.
    }
    return { code: 'IO_ERROR', message: error };
  }
  return { code: 'IO_ERROR', message: String(error) };
}
