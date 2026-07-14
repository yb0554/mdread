const path = require('node:path');
const { spawn } = require('node:child_process');

const executable = process.platform === 'win32' ? 'mdread.exe' : 'mdread';
const appBinaryPath = process.env.APP_BINARY
  || path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', executable);
const secondLaunchFixture = path.resolve(__dirname, 'fixtures', '快速切换-B.markdown');
describe('mdread desktop reader', () => {
  async function registerFixtureWorkspace() {
    await browser.execute(() => {
      const metadata = document.getElementById('document-meta');
      const path = metadata?.getAttribute('title');
      if (!path) throw new Error('Missing current document path');
      const folder = path.replace(/[\\/][^\\/]+$/, '');
      localStorage.setItem('mdread-folders', JSON.stringify([{ path: folder }]));
    });
    await browser.refresh();
    await browser.waitUntil(async () => (await $$('#file-tree .tree-root')).length === 1);
    await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.dataset.e2eReady === 'true')));
  }

  it('opens a Markdown document supplied by the operating system', async () => {
    const content = await $('#markdown-content');
    await content.waitForDisplayed();

    const heading = await content.$('h1');
    await heading.waitForDisplayed();
    expect(await heading.getText()).toBe('mdread E2E sample');

    const metadata = await $('#document-meta');
    expect(await metadata.getText()).toContain('reader-sample.md');
  });

  it('renders every outline heading once inside a clipped, scrollable panel', async () => {
    await browser.waitUntil(async () => (await $$('#outline-tree .outline-item')).length > 0);

    const metrics = await browser.execute(() => {
      const tree = document.getElementById('outline-tree');
      const headings = document.querySelectorAll('#markdown-content h1, #markdown-content h2, #markdown-content h3, #markdown-content h4, #markdown-content h5, #markdown-content h6');
      const items = Array.from(tree.querySelectorAll('.outline-item'));
      const first = items[0];
      const longItem = items.find((item) => item.textContent.includes('超长标题'));
      const style = getComputedStyle(tree);
      return {
        headingCount: headings.length,
        itemCount: items.length,
        targetCount: new Set(items.map((item) => item.dataset.target)).size,
        overflowY: style.overflowY,
        itemDisplay: getComputedStyle(first).display,
        itemWidth: first.getBoundingClientRect().width,
        treeWidth: tree.getBoundingClientRect().width,
        hasVerticalOverflow: tree.scrollHeight > tree.clientHeight,
        hasHorizontalOverflow: tree.scrollWidth > tree.clientWidth,
        longItemIsTruncated: longItem.scrollWidth > longItem.clientWidth,
        longItemTextOverflow: getComputedStyle(longItem).textOverflow,
      };
    });

    expect(metrics.itemCount).toBe(metrics.headingCount);
    expect(metrics.targetCount).toBe(metrics.headingCount);
    expect(metrics.overflowY).toBe('scroll');
    expect(metrics.itemDisplay).toBe('block');
    expect(metrics.itemWidth).toBeLessThanOrEqual(metrics.treeWidth);
    expect(metrics.hasVerticalOverflow).toBe(true);
    expect(metrics.hasHorizontalOverflow).toBe(false);
    expect(metrics.longItemIsTruncated).toBe(true);
    expect(metrics.longItemTextOverflow).toBe('ellipsis');
  });

  it('uses the real workspace tree for deep folders, truncation and document switching', async () => {
    await registerFixtureWorkspace();
    const root = await $('#file-tree .tree-root');
    await root.waitForDisplayed();

    const longFolder = await $('#file-tree .tree-node.folder > .tree-node-row[title*="__pycache__"]');
    await longFolder.waitForDisplayed();
    await longFolder.click();
    const nestedFolder = await $('#file-tree .tree-node.folder > .tree-node-row[title="深层目录"]');
    await nestedFolder.waitForDisplayed();
    await nestedFolder.click();
    const longFile = await $('#file-tree .tree-node.file > .tree-node-row[title*="多账号ECS"]');
    await longFile.waitForDisplayed();

    const metrics = await browser.execute(() => {
      const root = document.querySelector('#file-tree .tree-root');
      const longFolderLabel = document.querySelector('.tree-node.folder > .tree-node-row[title*="__pycache__"] .tree-label');
      const longFileLabel = document.querySelector('.tree-node.file > .tree-node-row[title*="多账号ECS"] .tree-label');
      return {
        rootHasNoHorizontalOverflow: root.scrollWidth <= root.clientWidth,
        longFolderIsTruncated: longFolderLabel.scrollWidth > longFolderLabel.clientWidth,
        longFileIsTruncated: longFileLabel.scrollWidth > longFileLabel.clientWidth,
        longFolderTextOverflow: getComputedStyle(longFolderLabel).textOverflow,
        longFileTextOverflow: getComputedStyle(longFileLabel).textOverflow,
      };
    });
    expect(metrics.rootHasNoHorizontalOverflow).toBe(true);
    expect(metrics.longFolderIsTruncated).toBe(true);
    expect(metrics.longFileIsTruncated).toBe(true);
    expect(metrics.longFolderTextOverflow).toBe('ellipsis');
    expect(metrics.longFileTextOverflow).toBe('ellipsis');

    await (await $('#file-tree .tree-node.file > .tree-node-row[title="快速切换-A.md"]')).click();
    await (await $('#file-tree .tree-node.file > .tree-node-row[title="快速切换-B.markdown"]')).click();
    await browser.waitUntil(async () => browser.execute(() => {
      const heading = document.querySelector('#markdown-content h1')?.textContent;
      const content = document.getElementById('markdown-content');
      const empty = document.getElementById('empty-state');
      return heading === '文档 B'
        && !content?.classList.contains('hidden')
        && empty && getComputedStyle(empty).display === 'none';
    }));
    expect(await browser.execute(() => document.querySelector('.tree-node.file.selected > .tree-node-row')?.getAttribute('title')))
      .toBe('快速切换-B.markdown');
  });

  it('opens the outline as a scrollable drawer in a narrow window', async () => {
    await (await $('#file-tree .tree-node.file > .tree-node-row[title="reader-sample.md"]')).click();
    await browser.waitUntil(async () => browser.execute(() => document.querySelector('#markdown-content h1')?.textContent === 'mdread E2E sample'));
    await browser.setWindowSize(900, 700);
    const toggle = await $('#outline-toggle');
    await toggle.waitForDisplayed();
    await toggle.click();
    const panel = await $('#outline');
    await panel.waitForDisplayed();
    expect(await panel.getAttribute('data-drawer')).toBe('');
    const tree = await $('#outline-tree');
    expect((await tree.getCSSProperty('overflow-y')).value).toBe('scroll');
    await (await $('#outline-close')).click();
    await expect(panel).toHaveElementClass('hidden');
    await browser.setWindowSize(1000, 700);
  });

  it('exposes the reading commands through the accessible menu', async () => {
    const menuButton = await $('#menu-btn');
    await menuButton.click();

    const menu = await $('#menu-popup');
    await expect(menu).not.toHaveElementClass('hidden');

    const labels = await browser.execute(() => Array.from(
      document.querySelectorAll('#menu-popup [role="menuitem"]'),
      (item) => item.textContent?.trim() || '',
    ));
    expect(labels).toContain('🖨 打印 / 导出 PDF');
    expect(labels).toContain('📂 在文件管理器中显示当前文档');
  });

  it('forwards a document from a second system launch to the active instance', async () => {
    const secondLaunch = spawn(appBinaryPath, [secondLaunchFixture], {
      stdio: 'ignore',
      windowsHide: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        secondLaunch.kill();
        reject(new Error('The second mdread launch did not exit after forwarding the document.'));
      }, 15_000);
      secondLaunch.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      secondLaunch.once('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`The second mdread launch exited with code ${code}.`));
          return;
        }
        resolve();
      });
    });

    await browser.waitUntil(async () => browser.execute(() => {
      const heading = document.querySelector('#markdown-content h1')?.textContent;
      const metadata = document.getElementById('document-meta')?.textContent || '';
      return heading === '文档 B' && metadata.includes('快速切换-B.markdown');
    }), {
      timeout: 15_000,
      timeoutMsg: 'The active instance did not open the document forwarded by the second launch.',
    });
  });
});
