use std::fs;
use std::path::Path;
use serde::Serialize;

/// 文件条目结构体 — 前端文件树渲染所需信息
#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
}

/// 列出目录内容 (仅 .md/.markdown 文件和子目录)
/// 天然只读: 仅读取目录, 不涉及任何写操作
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("无法读取目录: {}", e))?;
    let mut result = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();

        // 跳过隐藏文件/文件夹 (以 . 开头, 如 .git, .vscode)
        if file_name.starts_with('.') {
            continue;
        }

        // 跳过 node_modules 目录
        if file_name == "node_modules" {
            continue;
        }

        let file_type = entry.file_type().map_err(|e| format!("获取文件类型失败: {}", e))?;

        if file_type.is_dir() {
            result.push(FileEntry {
                name: file_name,
                path: file_path,
                is_dir: true,
                extension: None,
            });
        } else {
            // 只包含 .md 和 .markdown 文件
            let ext = Path::new(&file_name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase());

            if let Some(ref ext) = ext {
                if ext == "md" || ext == "markdown" {
                    result.push(FileEntry {
                        name: file_name,
                        path: file_path,
                        is_dir: false,
                        extension: Some(ext.clone()),
                    });
                }
            }
        }
    }

    // 排序: 文件夹在前, 然后按名称排序 (不区分大小写)
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

/// 读取文件内容 (仅限 .md/.markdown 文件)
/// 天然只读: 仅读取文件内容, 不涉及任何写操作
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);

    // 验证文件扩展名 — 安全防线
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .ok_or("文件没有扩展名")?;

    if ext != "md" && ext != "markdown" {
        return Err("只支持 .md 和 .markdown 文件".to_string());
    }

    let content = {
        let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {}", e))?;
        // 先尝试 UTF-8, 失败则回退 GBK 解码 (兼容中文 Windows GBK/GB2312 编码)
        match String::from_utf8(bytes.clone()) {
            Ok(s) => s,
            Err(_) => {
                let (cow, _enc, _had_errors) = encoding_rs::GBK.decode(&bytes);
                cow.into_owned()
            }
        }
    };
    Ok(content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_directory, read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
