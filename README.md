# mdread

> 一款轻量、专注、本地优先的 Markdown 阅读器，基于 Tauri 2 构建。

mdread 不编辑、只阅读。所有文件操作均为只读，配合 DOMPurify 净化与 CSP 策略，提供安全、纯净的桌面阅读体验。

## 界面预览

![mdread 界面预览](screenshots/01-app-overview-v2.png)

## 功能特性

### 阅读体验

- **GitHub 风格 Markdown（GFM）**：支持表格、任务列表、删除线、自动换行
- **代码语法高亮**：基于 highlight.js，支持常见语言自动识别
- **代码块一键复制**：每个代码块右上角附带复制按钮
- **文档大纲**：右侧独立面板，点击跳转，滚动高亮（IntersectionObserver）
- **阅读进度条**：顶部进度条实时反映阅读位置
- **字体缩放**：70% – 180% 无级调节，偏好持久化

### 主题与字体

- 5 套主题：浅色 / 深色 / 护眼 / Dracula / One Dark
- 4 套字体样式：默认 / 衬线 / 等宽 / 紧凑
- 所有偏好通过 `localStorage` 持久化保存

### 文件管理

- **多文件夹侧边栏**：可添加多个根目录，每个可独立移除
- **懒加载 + 缓存**：仅在展开时加载子目录，大目录也不卡顿
- **文件搜索过滤**：侧边栏搜索框实时过滤（300ms 防抖）
- **最近文件**：折叠展示最近 1 个，可展开查看全部（上限 10 个）
- **拖拽打开**：将 `.md` 文件直接拖入窗口即可打开

### 编码与兼容

- **UTF-8 / GBK 自动识别**：先尝试 UTF-8，失败自动回退 GBK 解码，兼容中文 Windows 下 GBK 编码文件
- **本地图片路径解析**：Markdown 中的相对图片路径自动转换为 asset 协议 URL 显示

### 安全性

- **后端只读**：`list_directory` 与 `read_file` 均为纯读操作，无任何写操作
- **文件扩展名校验**：仅允许读取 `.md` / `.markdown` 文件
- **HTML 净化**：DOMPurify 过滤 `script` / `iframe` / `form` 等危险标签与 `onerror` / `onload` 等事件属性
- **CSP 策略**：限制脚本、样式、图片等资源的加载来源

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 |
| 前端 | TypeScript + Vite |
| Markdown 解析 | marked v15（GFM） |
| 语法高亮 | highlight.js + marked-highlight |
| 安全净化 | DOMPurify |
| 编码处理 | encoding-rs（GBK 回退） |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+O` | 添加文件夹 |
| `Ctrl+B` | 切换侧边栏显隐 |
| `Ctrl+Shift+O` | 切换文档大纲 |
| `Ctrl+=` / `Ctrl+-` | 放大 / 缩小字体 |
| `Ctrl+0` | 重置字体大小 |

## 从源码构建

### 环境要求

- Node.js 18+
- Rust（stable 工具链）
- Tauri 2 前置依赖：Windows 需要 WebView2 与 Visual Studio C++ 构建工具

### 构建步骤

```bash
# 安装前端依赖
npm install

# 开发模式（热重载）
npm run tauri dev

# 生产构建（生成安装包）
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
mdread/
├── src/                     # 前端源码
│   ├── main.ts              # 主入口 + 统一菜单
│   ├── renderer.ts          # Markdown 渲染（marked + DOMPurify）
│   ├── filetree.ts          # 文件树侧边栏（多文件夹/懒加载/缓存）
│   ├── outline.ts           # 文档大纲 + 滚动高亮 + 复制按钮 + 进度条
│   ├── search.ts            # 文件搜索过滤
│   ├── shortcuts.ts         # 键盘快捷键 + 字体缩放
│   ├── theme.ts             # 主题与字体管理
│   ├── recent.ts            # 最近文件
│   ├── dragdrop.ts          # 拖拽打开
│   └── styles/              # 样式文件
├── src-tauri/
│   ├── src/lib.rs           # Rust 后端（list_directory / read_file）
│   └── tauri.conf.json      # Tauri 配置
├── index.html
├── package.json
└── vite.config.ts
```

## License

[MIT](LICENSE)
# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
