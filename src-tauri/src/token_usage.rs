use serde::Serialize;
use serde_json::Value;
use std::{env, fs::{self, File}, io::{BufRead, BufReader}, path::{Path, PathBuf}};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub task_tokens: Option<u64>,
    pub session_tokens: Option<u64>,
}

fn codex_sessions_dir() -> Result<PathBuf, String> {
    let home = env::var_os("CODEX_HOME").filter(|value| !value.is_empty())
        .or_else(|| env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .filter(|value| !value.is_empty()).map(|value| PathBuf::from(value).join(".codex").into_os_string()))
        .ok_or("无法确定 Codex 会话目录")?;
    Ok(PathBuf::from(home).join("sessions"))
}

fn session_file(dir: &Path, session_id: &str) -> Result<Option<PathBuf>, String> {
    // 会话 ID 只作为文件名后缀匹配，不能参与路径拼接。
    if session_id.is_empty() || !session_id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-') {
        return Err("会话 ID 格式无效".into());
    }
    let suffix = format!("-{session_id}.jsonl");
    let mut dirs = vec![dir.to_path_buf()];
    while let Some(path) = dirs.pop() {
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("读取 Codex 会话目录失败：{error}")),
        };
        for entry in entries {
            let entry = entry.map_err(|error| format!("遍历 Codex 会话目录失败：{error}"))?;
            let kind = entry.file_type().map_err(|error| format!("读取会话文件类型失败：{error}"))?;
            if kind.is_dir() { dirs.push(entry.path()); }
            else if kind.is_file() && entry.file_name().to_string_lossy().ends_with(&suffix) { return Ok(Some(entry.path())); }
        }
    }
    Ok(None)
}

fn parse_usage(reader: impl BufRead, session_id: &str, requested_turn: Option<&str>) -> Result<Option<TokenUsage>, String> {
    let mut latest_session_total = None;
    let mut task_tokens = None;
    for line in reader.lines() {
        let line = line.map_err(|error| format!("读取 Codex 会话记录失败：{error}"))?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        if value.get("type").and_then(Value::as_str) != Some("token_usage_record") { continue; }
        let Some(payload) = value.get("payload") else { continue };
        if payload.get("thread_id").and_then(Value::as_str) != Some(session_id) { continue; }
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else { continue };
        let session_total = payload.pointer("/thread_token_usage/total_tokens").and_then(Value::as_u64);
        let turn_total = payload.pointer("/turn_token_usage/total_tokens").and_then(Value::as_u64);
        latest_session_total = Some(session_total);
        if requested_turn.is_none_or(|requested| requested == turn_id) { task_tokens = turn_total; }
    }
    Ok(latest_session_total.map(|session_tokens| TokenUsage {
        task_tokens,
        session_tokens,
    }))
}

fn read_token_usage_blocking(session_id: &str, turn_id: Option<&str>) -> Result<Option<TokenUsage>, String> {
    let Some(path) = session_file(&codex_sessions_dir()?, session_id)? else { return Ok(None) };
    let file = File::open(path).map_err(|error| format!("打开 Codex 会话记录失败：{error}"))?;
    parse_usage(BufReader::new(file), session_id, turn_id)
}

#[tauri::command]
pub async fn read_token_usage(session_id: String, turn_id: Option<String>) -> Result<Option<TokenUsage>, String> {
    tauri::async_runtime::spawn_blocking(move || read_token_usage_blocking(&session_id, turn_id.as_deref()))
        .await.map_err(|error| format!("后台查询 token 用量失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn reads_explicit_turn_and_thread_totals() {
        let data = concat!(
            "{\"type\":\"token_usage_record\",\"payload\":{\"thread_id\":\"s\",\"turn_id\":\"a\",\"turn_token_usage\":{\"total_tokens\":100},\"thread_token_usage\":{\"total_tokens\":100}}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"total_tokens\":3}}}}\n",
            "{\"type\":\"token_usage_record\",\"payload\":{\"thread_id\":\"s\",\"turn_id\":\"b\",\"turn_token_usage\":{\"total_tokens\":30},\"thread_token_usage\":{\"total_tokens\":130}}}\n",
            "{\"type\":\"token_usage_record\",\"payload\":{\"thread_id\":\"s\",\"turn_id\":\"b\",\"turn_token_usage\":{\"total_tokens\":60},\"thread_token_usage\":{\"total_tokens\":160}}}\n",
        );
        let usage = parse_usage(Cursor::new(data), "s", Some("b")).unwrap().unwrap();
        assert_eq!(usage.task_tokens, Some(60));
        assert_eq!(usage.session_tokens, Some(160));
        assert_eq!(parse_usage(Cursor::new(data), "s", None).unwrap().unwrap().task_tokens, Some(60));
        let earlier = parse_usage(Cursor::new(data), "s", Some("a")).unwrap().unwrap();
        assert_eq!(earlier.task_tokens, Some(100));
        assert_eq!(earlier.session_tokens, Some(160));
        assert!(parse_usage(Cursor::new(data), "other", None).unwrap().is_none());
    }

    #[test]
    fn missing_turn_usage_is_unknown() {
        let data = "{\"type\":\"token_usage_record\",\"payload\":{\"thread_id\":\"s\",\"turn_id\":\"a\",\"turn_token_usage\":{\"total_tokens\":7},\"thread_token_usage\":{\"total_tokens\":7}}}\n";
        let usage = parse_usage(Cursor::new(data), "s", Some("missing")).unwrap().unwrap();
        assert_eq!(usage.task_tokens, None);
        assert_eq!(usage.session_tokens, Some(7));
    }
}
