use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use encoding_rs::GBK;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

const LARGE_FILE_CONFIRMATION_BYTES: u64 = 25 * 1024 * 1024;
const SEARCH_FILE_LIMIT_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_size: Option<u64>,
}

type AppResult<T> = Result<T, AppError>;

impl AppError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            byte_size: None,
        }
    }

    fn file_too_large(byte_size: u64) -> Self {
        Self {
            code: "FILE_TOO_LARGE",
            message: format!("文件大小为 {} MiB，打开前需要确认", byte_size / 1024 / 1024),
            byte_size: Some(byte_size),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDescriptor {
    id: String,
    path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    relative_path: String,
    is_dir: bool,
    extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentRef {
    workspace_id: Option<String>,
    document_id: Option<String>,
    relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    document_ref: DocumentRef,
    name: String,
    content: String,
    encoding: String,
    byte_size: u64,
    modified_at: u64,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchSession {
    id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangedEvent {
    session_id: String,
    document_ref: DocumentRef,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    document_ref: DocumentRef,
    name: String,
    relative_path: String,
    match_kind: String,
    snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDocumentsEvent {
    paths: Vec<String>,
}

#[derive(Default)]
struct LaunchState {
    initial_paths: Mutex<Vec<String>>,
}

#[derive(Clone)]
struct AuthorizedDocument {
    path: PathBuf,
    // Standalone documents need their parent directory for local image assets.
    // Workspace documents inherit the workspace resource scope instead.
    scope_root: Option<PathBuf>,
}

#[derive(Default)]
struct WorkspaceRegistry {
    next_id: u64,
    workspaces: HashMap<String, PathBuf>,
    documents: HashMap<String, AuthorizedDocument>,
    applied_asset_scopes: Vec<PathBuf>,
}

#[derive(Clone, Default)]
struct SearchState {
    cancelled_requests: Arc<Mutex<HashSet<String>>>,
}

struct ActiveWatch {
    id: String,
    path: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
struct WatchState {
    active: Mutex<Option<ActiveWatch>>,
}

fn lock_registry<'a>(
    state: &'a State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<std::sync::MutexGuard<'a, WorkspaceRegistry>> {
    state
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "工作区状态不可用，请重启应用"))
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some(extension) if extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
    )
}

fn canonical_existing(path: &Path) -> AppResult<PathBuf> {
    fs::canonicalize(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "NOT_FOUND"
        } else {
            "IO_ERROR"
        };
        AppError::new(code, format!("无法访问路径: {error}"))
    })
}

fn safe_relative_path(relative_path: &str) -> AppResult<&Path> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty() {
        return Ok(relative);
    }
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::new(
            "NOT_AUTHORIZED",
            "路径必须位于已授权工作区内",
        ));
    }
    Ok(relative)
}

fn resolve_workspace_path(root: &Path, relative_path: &str) -> AppResult<PathBuf> {
    let relative = safe_relative_path(relative_path)?;
    let resolved = canonical_existing(&root.join(relative))?;
    if !resolved.starts_with(root) {
        return Err(AppError::new("NOT_AUTHORIZED", "目标路径不属于当前工作区"));
    }
    Ok(resolved)
}

fn canonical_workspace_member(root: &Path, candidate: &Path) -> Option<PathBuf> {
    fs::canonicalize(candidate)
        .ok()
        .filter(|resolved| resolved.starts_with(root))
}

fn document_id_for(
    registry: &mut WorkspaceRegistry,
    path: &Path,
    scope_root: Option<PathBuf>,
) -> String {
    if let Some((id, document)) = registry
        .documents
        .iter_mut()
        .find(|(_, document)| document.path.as_path() == path)
    {
        if document.scope_root.is_none() && scope_root.is_some() {
            document.scope_root = scope_root;
        }
        return id.clone();
    }
    registry.next_id += 1;
    let id = format!("doc-{}", registry.next_id);
    registry.documents.insert(
        id.clone(),
        AuthorizedDocument {
            path: path.to_path_buf(),
            scope_root,
        },
    );
    id
}

fn release_document_from_registry(
    registry: &mut WorkspaceRegistry,
    document_id: &str,
) -> AppResult<AuthorizedDocument> {
    registry
        .documents
        .remove(document_id)
        .ok_or_else(|| AppError::new("NOT_FOUND", "文档授权不存在或已释放"))
}

fn is_workspace_document(registry: &WorkspaceRegistry, path: &Path) -> bool {
    registry
        .workspaces
        .values()
        .any(|root| path.starts_with(root))
}

fn desired_asset_scope_roots(registry: &WorkspaceRegistry) -> Vec<PathBuf> {
    registry
        .workspaces
        .values()
        .cloned()
        .chain(
            registry
                .documents
                .values()
                .filter_map(|document| document.scope_root.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn refresh_asset_protocol_scope(
    app: &AppHandle,
    registry: &mut WorkspaceRegistry,
) -> AppResult<()> {
    let previous = std::mem::take(&mut registry.applied_asset_scopes);
    for root in &previous {
        let _ = app.asset_protocol_scope().forbid_directory(root, true);
    }

    let desired = desired_asset_scope_roots(registry);
    for root in &desired {
        if let Err(error) = app.asset_protocol_scope().allow_directory(root, true) {
            for previous_root in &previous {
                let _ = app
                    .asset_protocol_scope()
                    .allow_directory(previous_root, true);
            }
            registry.applied_asset_scopes = previous;
            return Err(AppError::new(
                "IO_ERROR",
                format!("无法授权文档资源: {error}"),
            ));
        }
    }
    registry.applied_asset_scopes = desired;
    Ok(())
}

fn workspace_ref_for_path(
    registry: &WorkspaceRegistry,
    path: &Path,
    document_id: Option<String>,
) -> DocumentRef {
    let workspace = registry
        .workspaces
        .iter()
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.components().count());

    if let Some((workspace_id, root)) = workspace {
        let relative_path = path
            .strip_prefix(root)
            .ok()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .replace('\\', "/");
        DocumentRef {
            workspace_id: Some(workspace_id.clone()),
            document_id,
            relative_path: Some(relative_path),
        }
    } else {
        DocumentRef {
            workspace_id: None,
            document_id,
            relative_path: None,
        }
    }
}

fn resolve_document(
    document_ref: &DocumentRef,
    registry: &WorkspaceRegistry,
) -> AppResult<PathBuf> {
    if let Some(document_id) = &document_ref.document_id {
        if let Some(document) = registry.documents.get(document_id) {
            let path = canonical_existing(&document.path)?;
            if !is_markdown(&path) {
                return Err(AppError::new(
                    "NOT_AUTHORIZED",
                    "只支持 .md 和 .markdown 文件",
                ));
            }
            return Ok(path);
        }
    }

    let workspace_id = document_ref
        .workspace_id
        .as_ref()
        .ok_or_else(|| AppError::new("NOT_AUTHORIZED", "文档未授权"))?;
    let relative_path = document_ref
        .relative_path
        .as_ref()
        .ok_or_else(|| AppError::new("NOT_AUTHORIZED", "缺少工作区内相对路径"))?;
    let root = registry
        .workspaces
        .get(workspace_id)
        .ok_or_else(|| AppError::new("NOT_AUTHORIZED", "工作区未授权或已移除"))?;
    let path = resolve_workspace_path(root, relative_path)?;
    if !is_markdown(&path) {
        return Err(AppError::new(
            "NOT_AUTHORIZED",
            "只支持 .md 和 .markdown 文件",
        ));
    }
    Ok(path)
}

fn decode_markdown(bytes: Vec<u8>) -> (String, String, Vec<String>) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "utf-8".into(),
            Vec::new(),
        );
    }

    match String::from_utf8(bytes.clone()) {
        Ok(content) => (content, "utf-8".into(), Vec::new()),
        Err(_) => {
            let (content, _, had_errors) = GBK.decode(&bytes);
            let warnings = if had_errors {
                vec!["文件不是有效 UTF-8，GBK 解码中包含无法识别的字符".into()]
            } else {
                vec!["文件已按 GBK/GB18030 兼容模式读取".into()]
            };
            (content.into_owned(), "gbk".into(), warnings)
        }
    }
}

fn collect_markdown_launch_paths(
    arguments: impl IntoIterator<Item = String>,
    current_directory: &Path,
) -> Vec<String> {
    arguments
        .into_iter()
        .filter(|argument| !argument.starts_with('-'))
        .filter_map(|argument| {
            let candidate = PathBuf::from(argument);
            let candidate = if candidate.is_absolute() {
                candidate
            } else {
                current_directory.join(candidate)
            };
            let path = fs::canonicalize(candidate).ok()?;
            (path.is_file() && is_markdown(&path)).then(|| path.to_string_lossy().to_string())
        })
        .collect()
}

#[tauri::command]
fn take_initial_launch_paths(state: State<'_, LaunchState>) -> AppResult<Vec<String>> {
    let mut paths = state
        .initial_paths
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "启动参数状态不可用"))?;
    Ok(std::mem::take(&mut *paths))
}

fn modified_at(path: &Path) -> u64 {
    path.metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[tauri::command]
fn register_workspace(
    path: String,
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<WorkspaceDescriptor> {
    let root = canonical_existing(Path::new(&path))?;
    if !root.is_dir() {
        return Err(AppError::new("NOT_FOUND", "请选择一个文件夹"));
    }

    let mut registry = lock_registry(&state)?;
    let existing_id = registry
        .workspaces
        .iter()
        .find_map(|(id, value)| (value == &root).then(|| id.clone()));
    let id = existing_id.clone().unwrap_or_else(|| {
        registry.next_id += 1;
        let id = format!("ws-{}", registry.next_id);
        registry.workspaces.insert(id.clone(), root.clone());
        id
    });
    if let Err(error) = refresh_asset_protocol_scope(&app, &mut registry) {
        if existing_id.is_none() {
            registry.workspaces.remove(&id);
        }
        return Err(error);
    }

    Ok(WorkspaceDescriptor {
        id,
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
        path: root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn remove_workspace(
    workspace_id: String,
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceRegistry>>,
    watch_state: State<'_, WatchState>,
) -> AppResult<()> {
    let root = {
        let mut registry = lock_registry(&state)?;
        let root = registry
            .workspaces
            .remove(&workspace_id)
            .ok_or_else(|| AppError::new("NOT_FOUND", "工作区不存在"))?;
        let remaining_workspace_roots = registry.workspaces.values().cloned().collect::<Vec<_>>();
        registry.documents.retain(|_, document| {
            !document.path.starts_with(&root)
                || remaining_workspace_roots
                    .iter()
                    .any(|remaining_root| document.path.starts_with(remaining_root))
        });
        refresh_asset_protocol_scope(&app, &mut registry)?;
        root
    };

    let mut active = watch_state
        .active
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "文件监听状态不可用"))?;
    if active
        .as_ref()
        .is_some_and(|watch| watch.path.starts_with(&root))
    {
        *active = None;
    }
    Ok(())
}

#[tauri::command]
fn list_directory(
    workspace_id: String,
    relative_path: Option<String>,
    state: State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<Vec<FileEntry>> {
    let registry = lock_registry(&state)?;
    let root = registry
        .workspaces
        .get(&workspace_id)
        .ok_or_else(|| AppError::new("NOT_AUTHORIZED", "工作区未授权或已移除"))?;
    let relative_path = relative_path.unwrap_or_default();
    let directory = resolve_workspace_path(root, &relative_path)?;
    if !directory.is_dir() {
        return Err(AppError::new("NOT_FOUND", "目标不是文件夹"));
    }

    let mut result = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| AppError::new("IO_ERROR", format!("无法读取目录: {error}")))?
    {
        let entry =
            entry.map_err(|error| AppError::new("IO_ERROR", format!("读取条目失败: {error}")))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| AppError::new("IO_ERROR", format!("无法读取条目类型: {error}")))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = match canonical_workspace_member(root, &entry.path()) {
            Some(path) => path,
            None => continue,
        };
        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::new("NOT_AUTHORIZED", "目录条目超出工作区范围"))?
            .to_string_lossy()
            .replace('\\', "/");

        if file_type.is_dir() {
            result.push(FileEntry {
                name,
                relative_path: relative,
                is_dir: true,
                extension: None,
            });
        } else if file_type.is_file() && is_markdown(&path) {
            result.push(FileEntry {
                name,
                relative_path: relative,
                is_dir: false,
                extension: path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.to_lowercase()),
            });
        }
    }

    result.sort_by(|left, right| match (left.is_dir, right.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });
    Ok(result)
}

#[tauri::command]
fn authorize_document(
    path: String,
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<DocumentRef> {
    let path = canonical_existing(Path::new(&path))?;
    if !is_markdown(&path) {
        return Err(AppError::new(
            "NOT_AUTHORIZED",
            "只支持 .md 和 .markdown 文件",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("NOT_FOUND", "文档没有父目录"))?;

    let mut registry = lock_registry(&state)?;
    if is_workspace_document(&registry, &path) {
        return Ok(workspace_ref_for_path(&registry, &path, None));
    }

    let document_id = document_id_for(&mut registry, &path, Some(parent.to_path_buf()));
    refresh_asset_protocol_scope(&app, &mut registry)?;
    Ok(workspace_ref_for_path(&registry, &path, Some(document_id)))
}

#[tauri::command]
fn release_document(
    document_id: String,
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceRegistry>>,
    watch_state: State<'_, WatchState>,
) -> AppResult<()> {
    let path = {
        let mut registry = lock_registry(&state)?;
        let document = release_document_from_registry(&mut registry, &document_id)?;
        refresh_asset_protocol_scope(&app, &mut registry)?;
        document.path
    };

    let mut active = watch_state
        .active
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "文件监听状态不可用"))?;
    if active.as_ref().is_some_and(|watch| watch.path == path) {
        *active = None;
    }
    Ok(())
}

#[tauri::command]
fn open_document(
    document_ref: DocumentRef,
    allow_large: Option<bool>,
    state: State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<DocumentPayload> {
    let (path, document_ref) = {
        let mut registry = lock_registry(&state)?;
        let path = resolve_document(&document_ref, &registry)?;
        let document_id = (!is_workspace_document(&registry, &path))
            .then(|| document_id_for(&mut registry, &path, None));
        let reference = workspace_ref_for_path(&registry, &path, document_id);
        (path, reference)
    };

    let metadata = fs::metadata(&path)
        .map_err(|error| AppError::new("IO_ERROR", format!("无法读取文档元数据: {error}")))?;
    let byte_size = metadata.len();
    if byte_size > LARGE_FILE_CONFIRMATION_BYTES && !allow_large.unwrap_or(false) {
        return Err(AppError::file_too_large(byte_size));
    }

    let bytes = fs::read(&path)
        .map_err(|error| AppError::new("IO_ERROR", format!("读取文件失败: {error}")))?;
    let (content, encoding, warnings) = decode_markdown(bytes);
    Ok(DocumentPayload {
        document_ref,
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Markdown 文档")
            .to_string(),
        content,
        encoding,
        byte_size,
        modified_at: modified_at(&path),
        warnings,
    })
}

#[tauri::command]
fn reveal_document(
    document_ref: DocumentRef,
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceRegistry>>,
) -> AppResult<()> {
    let path = {
        let registry = lock_registry(&state)?;
        resolve_document(&document_ref, &registry)?
    };
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| AppError::new("IO_ERROR", format!("无法在文件管理器中显示文档: {error}")))
}

#[tauri::command]
fn watch_document(
    document_ref: DocumentRef,
    app: AppHandle,
    registry: State<'_, Mutex<WorkspaceRegistry>>,
    state: State<'_, WatchState>,
) -> AppResult<WatchSession> {
    let path = {
        let registry = lock_registry(&registry)?;
        resolve_document(&document_ref, &registry)?
    };
    let session_id = format!(
        "watch-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let event_reference = document_ref.clone();
    let event_session = session_id.clone();
    let app_handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::channel::<()>();

    let mut watcher =
        notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
            if let Ok(event) = result {
                if matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    let _ = sender.send(());
                }
            }
        })
        .map_err(|error| AppError::new("IO_ERROR", format!("无法创建文件监听器: {error}")))?;
    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|error| AppError::new("IO_ERROR", format!("无法监听文件: {error}")))?;

    let mut active = state
        .active
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "文件监听状态不可用"))?;
    *active = Some(ActiveWatch {
        id: session_id.clone(),
        path,
        _watcher: watcher,
    });
    drop(active);

    std::thread::spawn(move || {
        while receiver.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(220));
            while receiver.try_recv().is_ok() {}
            let _ = app_handle.emit(
                "file-changed",
                FileChangedEvent {
                    session_id: event_session.clone(),
                    document_ref: event_reference.clone(),
                },
            );
        }
    });

    Ok(WatchSession { id: session_id })
}

#[tauri::command]
fn unwatch_document(session_id: Option<String>, state: State<'_, WatchState>) -> AppResult<()> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "文件监听状态不可用"))?;
    if session_id
        .as_ref()
        .is_none_or(|id| active.as_ref().is_some_and(|watch| &watch.id == id))
    {
        *active = None;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct LowercaseSpan {
    lower_start: usize,
    lower_end: usize,
    original_start: usize,
    original_end: usize,
}

fn find_case_insensitive_span(content: &str, lowered_query: &str) -> Option<(usize, usize)> {
    if lowered_query.is_empty() {
        return None;
    }

    let mut lowered = String::with_capacity(content.len());
    let mut spans = Vec::new();
    for (original_start, character) in content.char_indices() {
        let original_end = original_start + character.len_utf8();
        let lower_start = lowered.len();
        lowered.extend(character.to_lowercase());
        let lower_end = lowered.len();
        spans.push(LowercaseSpan {
            lower_start,
            lower_end,
            original_start,
            original_end,
        });
    }

    let match_start = lowered.find(lowered_query)?;
    let match_end = match_start + lowered_query.len();
    let mut matches = spans
        .iter()
        .filter(|span| span.lower_start < match_end && span.lower_end > match_start);
    let first = matches.next()?;
    let last = matches.next_back().unwrap_or(first);
    Some((first.original_start, last.original_end))
}

fn snippet_around(content: &str, match_start: usize, match_end: usize) -> String {
    let start = content[..match_start]
        .char_indices()
        .rev()
        .nth(40)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let end = content[match_end..]
        .char_indices()
        .nth(140)
        .map(|(index, _)| match_end + index)
        .unwrap_or(content.len());
    content[start..end].replace('\n', " ")
}

fn is_search_cancelled(cancelled_requests: &Arc<Mutex<HashSet<String>>>, request_id: &str) -> bool {
    cancelled_requests
        .lock()
        .map(|requests| requests.contains(request_id))
        .unwrap_or(true)
}

struct SearchContext<'a> {
    root: &'a Path,
    query: &'a str,
    mode: &'a str,
    limit: usize,
    workspace_id: &'a str,
    request_id: &'a str,
    cancelled_requests: &'a Arc<Mutex<HashSet<String>>>,
}

fn search_directory(
    context: &SearchContext<'_>,
    directory: &Path,
    results: &mut Vec<SearchResult>,
) -> AppResult<bool> {
    if results.len() >= context.limit
        || is_search_cancelled(context.cancelled_requests, context.request_id)
    {
        return Ok(is_search_cancelled(
            context.cancelled_requests,
            context.request_id,
        ));
    }
    for entry in fs::read_dir(directory)
        .map_err(|error| AppError::new("IO_ERROR", format!("无法搜索目录: {error}")))?
    {
        if results.len() >= context.limit
            || is_search_cancelled(context.cancelled_requests, context.request_id)
        {
            return Ok(is_search_cancelled(
                context.cancelled_requests,
                context.request_id,
            ));
        }
        let entry = entry
            .map_err(|error| AppError::new("IO_ERROR", format!("读取搜索条目失败: {error}")))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| AppError::new("IO_ERROR", format!("无法读取搜索条目类型: {error}")))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = match canonical_workspace_member(context.root, &entry.path()) {
            Some(path) => path,
            None => continue,
        };
        if file_type.is_dir() {
            if search_directory(context, &path, results)? {
                return Ok(true);
            }
            continue;
        }
        if !file_type.is_file() || !is_markdown(&path) {
            continue;
        }
        let relative_path = path
            .strip_prefix(context.root)
            .map_err(|_| AppError::new("NOT_AUTHORIZED", "搜索条目超出工作区范围"))?
            .to_string_lossy()
            .replace('\\', "/");
        let name_matches = name.to_lowercase().contains(context.query);
        let mut snippet = None;
        let content_matches = if context.mode == "content"
            && fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0)
                <= SEARCH_FILE_LIMIT_BYTES
        {
            if is_search_cancelled(context.cancelled_requests, context.request_id) {
                return Ok(true);
            }
            let bytes = fs::read(&path).unwrap_or_default();
            if is_search_cancelled(context.cancelled_requests, context.request_id) {
                return Ok(true);
            }
            let (content, _, _) = decode_markdown(bytes);
            if let Some((match_start, match_end)) =
                find_case_insensitive_span(&content, context.query)
            {
                snippet = Some(snippet_around(&content, match_start, match_end));
                true
            } else {
                false
            }
        } else {
            false
        };
        if name_matches || content_matches {
            results.push(SearchResult {
                document_ref: DocumentRef {
                    workspace_id: Some(context.workspace_id.to_string()),
                    document_id: None,
                    relative_path: Some(relative_path.clone()),
                },
                name,
                relative_path,
                match_kind: if name_matches {
                    "filename".into()
                } else {
                    "content".into()
                },
                snippet,
            });
        }
    }
    Ok(false)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Vec<SearchResult>,
    cancelled: bool,
}

#[tauri::command]
fn cancel_search(request_id: String, state: State<'_, SearchState>) -> AppResult<()> {
    let mut cancelled = state
        .cancelled_requests
        .lock()
        .map_err(|_| AppError::new("INTERNAL_ERROR", "搜索状态不可用"))?;
    cancelled.insert(request_id);
    Ok(())
}

#[tauri::command]
async fn search_workspace(
    workspace_id: String,
    query: String,
    mode: Option<String>,
    limit: Option<usize>,
    request_id: String,
    state: State<'_, Mutex<WorkspaceRegistry>>,
    search_state: State<'_, SearchState>,
) -> AppResult<SearchResponse> {
    let root = {
        let registry = lock_registry(&state)?;
        registry
            .workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| AppError::new("NOT_AUTHORIZED", "工作区未授权或已移除"))?
    };

    let query = query.trim().to_lowercase();
    let cancelled_requests = search_state.cancelled_requests.clone();
    let mode = mode.unwrap_or_else(|| "filename".into());
    let limit = limit.unwrap_or(100).min(500);
    let workspace_id_for_task = workspace_id.clone();
    let request_id_for_task = request_id.clone();

    let response = tauri::async_runtime::spawn_blocking(move || -> AppResult<SearchResponse> {
        {
            let mut cancelled = cancelled_requests
                .lock()
                .map_err(|_| AppError::new("INTERNAL_ERROR", "搜索状态不可用"))?;
            if cancelled.remove(&request_id_for_task) {
                return Ok(SearchResponse {
                    results: Vec::new(),
                    cancelled: true,
                });
            }
        }
        if query.is_empty() {
            return Ok(SearchResponse {
                results: Vec::new(),
                cancelled: false,
            });
        }
        let mut results = Vec::new();
        let context = SearchContext {
            root: &root,
            query: &query,
            mode: &mode,
            limit,
            workspace_id: &workspace_id_for_task,
            request_id: &request_id_for_task,
            cancelled_requests: &cancelled_requests,
        };
        let cancelled = search_directory(&context, &root, &mut results)?;
        let mut pending = cancelled_requests
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR", "搜索状态不可用"))?;
        let cancelled = cancelled || pending.remove(&request_id_for_task);
        Ok(SearchResponse { results, cancelled })
    })
    .await
    .map_err(|error| AppError::new("INTERNAL_ERROR", format!("搜索任务失败: {error}")))??;

    Ok(response)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let current_directory = std::env::current_dir().unwrap_or_default();
    let initial_paths = collect_markdown_launch_paths(std::env::args().skip(1), &current_directory);

    let builder = tauri::Builder::default()
        // Single-instance must be registered first so a second launch forwards its files.
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, current_directory| {
                let paths = collect_markdown_launch_paths(arguments, Path::new(&current_directory));
                if !paths.is_empty() {
                    let _ = app.emit("open-documents", OpenDocumentsEvent { paths });
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    // WebDriver hooks exist only in a dedicated E2E binary. Keeping this behind
    // a feature prevents test-control endpoints from being compiled into releases.
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(Mutex::new(WorkspaceRegistry::default()))
        .manage(WatchState {
            active: Mutex::new(None),
        })
        .manage(SearchState::default())
        .manage(LaunchState {
            initial_paths: Mutex::new(initial_paths),
        })
        .invoke_handler(tauri::generate_handler![
            register_workspace,
            remove_workspace,
            list_directory,
            authorize_document,
            release_document,
            open_document,
            reveal_document,
            watch_document,
            unwatch_document,
            cancel_search,
            search_workspace,
            take_initial_launch_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_paths() {
        assert!(safe_relative_path("../secret.md").is_err());
        assert!(safe_relative_path("/secret.md").is_err());
        assert!(safe_relative_path("docs/readme.md").is_ok());
    }

    #[test]
    fn decodes_utf8_bom() {
        let (content, encoding, warnings) =
            decode_markdown(vec![0xEF, 0xBB, 0xBF, b'#', b' ', b'A']);
        assert_eq!(content, "# A");
        assert_eq!(encoding, "utf-8");
        assert!(warnings.is_empty());
    }

    #[test]
    fn accepts_markdown_extensions_only() {
        assert!(is_markdown(Path::new("guide.md")));
        assert!(is_markdown(Path::new("guide.MARKDOWN")));
        assert!(!is_markdown(Path::new("guide.txt")));
    }

    #[test]
    fn rejects_workspace_members_resolving_outside_root() {
        let root = std::env::temp_dir().join(format!(
            "mdread-workspace-member-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before Unix epoch")
                .as_nanos()
        ));
        let workspace = root.join("workspace");
        let outside = root.join("outside.md");
        let inside = workspace.join("inside.md");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(&inside, "# Inside").expect("write workspace document");
        fs::write(&outside, "# Outside").expect("write outside document");

        let canonical_workspace = fs::canonicalize(&workspace).expect("canonical workspace");
        assert!(canonical_workspace_member(&canonical_workspace, &inside).is_some());
        assert!(canonical_workspace_member(&canonical_workspace, &outside).is_none());

        fs::remove_dir_all(root).expect("remove temporary workspace");
    }

    #[test]
    fn finds_unicode_content_without_using_lowercase_byte_offsets() {
        let content = "İstanbul — café";
        let (start, end) = find_case_insensitive_span(content, "i").expect("find Unicode match");
        assert_eq!(&content[start..end], "İ");

        let (start, end) = find_case_insensitive_span(content, "é").expect("find accented match");
        assert_eq!(&content[start..end], "é");
        assert_eq!(snippet_around(content, start, end), content);
    }

    #[test]
    fn releases_standalone_document_authorization() {
        let root = PathBuf::from("C:/mdread-fixture");
        let document = root.join("guide.md");
        let mut registry = WorkspaceRegistry::default();
        let id = document_id_for(&mut registry, &document, Some(root.clone()));

        let released =
            release_document_from_registry(&mut registry, &id).expect("release document");
        assert_eq!(released.path, document);
        assert_eq!(released.scope_root, Some(root));
        assert!(registry.documents.is_empty());
        assert!(release_document_from_registry(&mut registry, &id).is_err());
    }

    #[test]
    fn workspace_documents_do_not_create_standalone_authorizations() {
        let root = PathBuf::from("C:/mdread-fixture/workspace");
        let document = root.join("guide.md");
        let mut registry = WorkspaceRegistry::default();
        registry.workspaces.insert("workspace".into(), root);

        let reference = workspace_ref_for_path(&registry, &document, None);
        assert_eq!(reference.workspace_id.as_deref(), Some("workspace"));
        assert_eq!(reference.relative_path.as_deref(), Some("guide.md"));
        assert!(reference.document_id.is_none());
        assert!(registry.documents.is_empty());
    }
    #[test]
    fn preserves_nested_workspace_scope_when_parent_is_removed() {
        let parent = PathBuf::from("C:/mdread-fixture/parent");
        let nested = parent.join("nested");
        let document = nested.join("guide.md");
        let mut registry = WorkspaceRegistry::default();
        registry.workspaces.insert("parent".into(), parent.clone());
        registry.workspaces.insert("nested".into(), nested.clone());
        let id = document_id_for(&mut registry, &document, None);

        registry.workspaces.remove("parent");
        let remaining_workspace_roots = registry.workspaces.values().cloned().collect::<Vec<_>>();
        registry.documents.retain(|_, entry| {
            !entry.path.starts_with(&parent)
                || remaining_workspace_roots
                    .iter()
                    .any(|remaining_root| entry.path.starts_with(remaining_root))
        });

        assert!(registry.documents.contains_key(&id));
        assert_eq!(desired_asset_scope_roots(&registry), vec![nested]);
    }

    #[test]
    fn cancelled_search_returns_before_scanning_files() {
        let root = std::env::temp_dir().join(format!(
            "mdread-cancel-search-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create search fixture");
        fs::write(root.join("guide.md"), "# Guide").expect("write search fixture");
        let cancelled_requests = Arc::new(Mutex::new(HashSet::from(["request-1".to_string()])));
        let mut results = Vec::new();

        let context = SearchContext {
            root: &root,
            query: "guide",
            mode: "filename",
            limit: 100,
            workspace_id: "workspace",
            request_id: "request-1",
            cancelled_requests: &cancelled_requests,
        };
        let cancelled = search_directory(&context, &root, &mut results).expect("search fixture");

        assert!(cancelled);
        assert!(results.is_empty());
        fs::remove_dir_all(root).expect("remove search fixture");
    }

    #[test]
    fn collects_only_existing_markdown_launch_paths() {
        let root = std::env::temp_dir().join(format!(
            "mdread-launch-paths-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before Unix epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create temporary launch directory");
        let markdown = root.join("guide.md");
        let non_markdown = root.join("notes.txt");
        fs::write(&markdown, "# Guide").expect("write Markdown fixture");
        fs::write(&non_markdown, "not Markdown").expect("write text fixture");

        let paths = collect_markdown_launch_paths(
            vec![
                "--debug".to_string(),
                "guide.md".to_string(),
                "notes.txt".to_string(),
                "missing.md".to_string(),
            ],
            &root,
        );

        assert_eq!(
            paths,
            vec![fs::canonicalize(&markdown)
                .unwrap()
                .to_string_lossy()
                .to_string()]
        );
        fs::remove_dir_all(root).expect("remove temporary launch directory");
    }
}
