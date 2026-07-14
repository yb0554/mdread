import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';

interface RenderRequest {
  kind: 'render';
  requestId: number;
  content: string;
  enableHighlight: boolean;
}

interface RenderSuccess {
  kind: 'rendered';
  requestId: number;
  html: string;
  elapsedMs: number;
}

interface RenderFailure {
  kind: 'error';
  requestId: number;
  message: string;
}

function createParser(enableHighlight: boolean): Marked {
  const parser = new Marked({ gfm: true, breaks: true, async: false });
  if (enableHighlight) {
    parser.use(markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, language) {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(code, { language }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    }));
  }
  return parser;
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  if (request.kind !== 'render') return;

  const startedAt = performance.now();
  try {
    const html = createParser(request.enableHighlight).parse(request.content) as string;
    const response: RenderSuccess = {
      kind: 'rendered',
      requestId: request.requestId,
      html,
      elapsedMs: performance.now() - startedAt,
    };
    self.postMessage(response);
  } catch (error) {
    const response: RenderFailure = {
      kind: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
