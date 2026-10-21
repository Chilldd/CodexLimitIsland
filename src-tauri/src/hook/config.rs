use serde_json::Value;
use std::path::{Path, PathBuf};

const TEMPLATE_RAW: &str = include_str!("../../../hooks.example.json");

/// 解析目标 Codex hooks.json 的路径。
pub(crate) fn default_hooks_path() -> Result<PathBuf, String> {
    if let Some(codex_home) = std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(codex_home).join("hooks.json"));
    }
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "未找到用户主目录（USERPROFILE 或 HOME 环境变量未设置）".to_string())?;
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "未找到用户主目录（HOME 环境变量未设置）".to_string())?;

    Ok(PathBuf::from(home).join(".codex").join("hooks.json"))
}

/// 格式化命令字符串：使用带引号格式以确保含空格路径安全执行。
pub(crate) fn format_hook_command(executable: &Path) -> String {
    format!("\"{}\" --hook", executable.display())
}

fn is_codexlimit_handler(handler: &Value) -> bool {
    let Some(obj) = handler.as_object() else {
        return false;
    };
    if obj.get("type").and_then(|v| v.as_str()) != Some("command") {
        return false;
    }
    obj.get("command")
        .and_then(|v| v.as_str())
        .map(|cmd| cmd.to_ascii_lowercase().contains("codexlimit") && cmd.contains("--hook"))
        == Some(true)
}

/// 合并现有 hooks 配置与本程序的 hook 命令。
pub(crate) fn merge_hooks_config(existing_json: Option<&str>, executable: &Path) -> Result<String, String> {
    let template: Value =
        serde_json::from_str(TEMPLATE_RAW).map_err(|error| format!("解析内置 hooks.example.json 模板失败：{error}"))?;
    let template_hooks = template
        .get("hooks")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "模板 hooks.example.json 缺少 hooks 字段".to_string())?;

    let mut root: Value = match existing_json {
        Some(text) if !text.trim().is_empty() => {
            let parsed: Value = serde_json::from_str(text)
                .map_err(|error| format!("解析现有 hooks.json 失败：{error}，为保护用户配置已中止写入"))?;
            if !parsed.is_object() {
                return Err("现有 hooks.json 顶层必须为 JSON 对象".to_string());
            }
            parsed
        }
        _ => {
            let mut empty_root = serde_json::Map::new();
            if let Some(desc) = template.get("description") {
                empty_root.insert("description".to_string(), desc.clone());
            }
            empty_root.insert("hooks".to_string(), Value::Object(serde_json::Map::new()));
            Value::Object(empty_root)
        }
    };

    let hooks_val = root
        .as_object_mut()
        .ok_or_else(|| "现有 hooks.json 顶层必须为 JSON 对象".to_string())?
        .entry("hooks")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));

    let target_hooks = hooks_val
        .as_object_mut()
        .ok_or_else(|| "hooks.json 中的 hooks 字段必须为 JSON 对象".to_string())?;

    let command_str = format_hook_command(executable);

    for (event_name, template_event_val) in template_hooks {
        let template_items = template_event_val
            .as_array()
            .ok_or_else(|| format!("模板中事件 {event_name} 必须为数组"))?;

        let target_event_val = target_hooks
            .entry(event_name)
            .or_insert_with(|| Value::Array(Vec::new()));

        let target_items = target_event_val
            .as_array_mut()
            .ok_or_else(|| format!("现有 hooks.{} 必须为数组", event_name))?;

        // 提取模板中首个 hook handler 的 timeout（若有）
        let template_timeout = template_items.iter().find_map(|item| {
            item.get("hooks").and_then(|h| h.as_array()).and_then(|handlers| {
                handlers.iter().find_map(|handler| {
                    if is_codexlimit_handler(handler) {
                        handler.get("timeout").cloned()
                    } else {
                        None
                    }
                })
            })
        });

        let mut found = false;
        for item in target_items.iter_mut() {
            if let Some(handlers) = item.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                for handler in handlers.iter_mut() {
                    if is_codexlimit_handler(handler) {
                        if let Some(obj) = handler.as_object_mut() {
                            obj.insert("command".to_string(), Value::String(command_str.clone()));
                            if let Some(ref timeout) = template_timeout {
                                obj.insert("timeout".to_string(), timeout.clone());
                            }
                            found = true;
                        }
                    }
                }
            }
        }

        if !found {
            // 从模板中克隆该事件项，替换其 command 为当前程序命令，并追加到 target_items
            for template_item in template_items {
                let mut new_item = template_item.clone();
                if let Some(handlers) = new_item.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                    for handler in handlers.iter_mut() {
                        if is_codexlimit_handler(handler) {
                            if let Some(obj) = handler.as_object_mut() {
                                obj.insert("command".to_string(), Value::String(command_str.clone()));
                            }
                        }
                    }
                }
                target_items.push(new_item);
            }
        }
    }

    serde_json::to_string_pretty(&root).map_err(|error| format!("序列化 hooks.json 失败：{error}"))
}

/// 配置当前程序的 Codex Hook 规则并写回用户配置。
pub(crate) fn configure_codex_hooks() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|error| format!("获取当前程序路径失败：{error}"))?;
    let path = default_hooks_path()?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("读取 hooks.json 失败：{error}")),
    };

    let merged = merge_hooks_config(existing.as_deref(), &exe_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
    }
    std::fs::write(&path, merged).map_err(|error| format!("写入 hooks.json 失败：{error}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_hook_command_quotes_path() {
        let path = Path::new(r"C:\Program Files\Codex Limit\codexlimit.exe");
        assert_eq!(
            format_hook_command(path),
            "\"C:\\Program Files\\Codex Limit\\codexlimit.exe\" --hook"
        );
    }

    #[test]
    fn merge_creates_all_12_events_when_empty() {
        let exe = Path::new(r"C:\Test\codexlimit.exe");
        let result = merge_hooks_config(None, exe).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let hooks = parsed["hooks"].as_object().unwrap();

        assert_eq!(hooks.len(), 12);
        for (_event, items) in hooks {
            let item_arr = items.as_array().unwrap();
            assert_eq!(item_arr.len(), 1);
            let cmd = item_arr[0]["hooks"][0]["command"].as_str().unwrap();
            assert_eq!(cmd, "\"C:\\Test\\codexlimit.exe\" --hook");
        }
    }

    #[test]
    fn merge_preserves_third_party_hooks_and_appends() {
        let exe = Path::new(r"C:\Test\codexlimit.exe");
        let existing = r#"{
            "hooks": {
                "SessionStart": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": "notify-feishu.exe",
                                "timeout": 5
                            }
                        ]
                    }
                ]
            }
        }"#;
        let result = merge_hooks_config(Some(existing), exe).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();

        // 包含原有的 feishu hook 和新增的 codexlimit hook
        assert_eq!(session_start.len(), 2);
        assert_eq!(
            session_start[0]["hooks"][0]["command"].as_str().unwrap(),
            "notify-feishu.exe"
        );
        assert_eq!(
            session_start[1]["hooks"][0]["command"].as_str().unwrap(),
            "\"C:\\Test\\codexlimit.exe\" --hook"
        );
    }

    #[test]
    fn merge_updates_existing_codexlimit_hook_in_place_without_duplicates() {
        let old_exe = Path::new(r"C:\Old\codexlimit.exe");
        let initial = merge_hooks_config(None, old_exe).unwrap();

        let new_exe = Path::new(r"D:\New\codexlimit.exe");
        let updated = merge_hooks_config(Some(&initial), new_exe).unwrap();
        let parsed: Value = serde_json::from_str(&updated).unwrap();
        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();

        assert_eq!(session_start.len(), 1);
        assert_eq!(
            session_start[0]["hooks"][0]["command"].as_str().unwrap(),
            "\"D:\\New\\codexlimit.exe\" --hook"
        );
    }

    #[test]
    fn merge_rejects_invalid_json_without_corrupting() {
        let exe = Path::new(r"C:\Test\codexlimit.exe");
        let invalid = "{ not a valid json }";
        let err = merge_hooks_config(Some(invalid), exe).unwrap_err();
        assert!(err.contains("解析现有 hooks.json 失败"));
    }

    #[test]
    fn merge_rejects_non_object_root_or_hooks() {
        let exe = Path::new(r"C:\Test\codexlimit.exe");
        let array_root = "[]";
        let err = merge_hooks_config(Some(array_root), exe).unwrap_err();
        assert!(err.contains("顶层必须为 JSON 对象"));

        let invalid_hooks = "{\"hooks\": 123}";
        let err2 = merge_hooks_config(Some(invalid_hooks), exe).unwrap_err();
        assert!(err2.contains("hooks 字段必须为 JSON 对象"));
    }
}
