/** Helpers for documents delivered through the OS or a second app launch. */

export interface OpenDocumentsPayload {
  paths: string[];
}

const MARKDOWN_FILE_PATTERN = /\.(?:md|markdown)$/i;

/**
 * Choose the first Markdown path from an OS-delivered payload. The Rust side
 * performs authoritative canonicalization and authorization; this guard keeps
 * malformed event payloads from triggering confusing UI errors.
 */
export function selectMarkdownPath(paths: readonly string[] | undefined): string | null {
  if (!paths) return null;
  for (const path of paths) {
    const normalized = path.trim();
    if (normalized && MARKDOWN_FILE_PATTERN.test(normalized)) return normalized;
  }
  return null;
}
