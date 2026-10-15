use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub task_tokens: Option<u64>,
    pub session_tokens: Option<u64>,
}
fn sessions_dir(custom: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> Result<PathBuf, String> {
    custom
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.filter(|v| !v.is_empty()).map(|v| PathBuf::from(v).join(".codex")))
        .map(|v| v.join("sessions"))
        .ok_or("无法确定 Codex 会话目录".into())
}
fn codex_sessions_dir() -> Result<PathBuf, String> {
    sessions_dir(
        env::var_os("CODEX_HOME"),
        env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }),
    )
}
// UUIDv7 的前 48 位是 Unix 毫秒时间戳；仅作目录提示，失败仍兼容全目录查找。
fn date_hint(id: &str) -> Option<PathBuf> {
    if !crate::session_id::is_uuid(id) || id.as_bytes()[14] != b'7' {
        return None;
    }
    let hex = id.chars().filter(|c| *c != '-').take(12).collect::<String>();
    let millis = u64::from_str_radix(&hex, 16).ok()?;
    let days = (millis / 86_400_000) as i64;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    Some(PathBuf::from(format!("{year:04}/{month:02}/{day:02}")))
}
fn session_file(dir: &Path, id: &str, visited: &mut u64) -> Result<Option<PathBuf>, String> {
    if !crate::session_id::is_filename_id(id) {
        return Err("会话 ID 格式无效".into());
    }
    let suffix = format!("-{id}.jsonl");
    let mut dirs = vec![dir.to_path_buf()];
    if let Some(hint) = date_hint(id) {
        dirs.push(dir.join(hint));
    }
    while let Some(path) = dirs.pop() {
        *visited += 1;
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("读取 Codex 会话目录失败".into()),
        };
        let mut sub = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| "遍历 Codex 会话目录失败")?;
            let kind = entry.file_type().map_err(|_| "读取会话文件类型失败")?;
            if kind.is_dir() {
                sub.push(entry.path());
            } else if kind.is_file() && entry.file_name().to_string_lossy().ends_with(&suffix) {
                return Ok(Some(entry.path()));
            }
        }
        sub.sort();
        dirs.extend(sub);
    }
    Ok(None)
}
fn token_record(value: Option<Value>, id: &str) -> Option<(String, TokenUsage)> {
    let value = value?;
    if value.get("type")?.as_str()? != "token_usage_record" {
        return None;
    }
    let payload = value.get("payload")?;
    if payload.get("thread_id")?.as_str()? != id {
        return None;
    }
    let turn = payload.get("turn_id")?.as_str()?.to_string();
    Some((
        turn,
        TokenUsage {
            task_tokens: payload
                .pointer("/turn_token_usage/total_tokens")
                .and_then(Value::as_u64),
            session_tokens: payload
                .pointer("/thread_token_usage/total_tokens")
                .and_then(Value::as_u64),
        },
    ))
}
const MAX_SESSIONS: usize = 64;
const MAX_TURNS: usize = 128;
const MAX_RECORD_BYTES: u64 = 1024 * 1024;
type CacheKey = (PathBuf, String);
type SharedFile = Arc<Mutex<FileCache>>;
#[derive(Default)]
struct Index {
    files: HashMap<CacheKey, SharedFile>,
    order: VecDeque<CacheKey>,
}
#[derive(Clone, Default)]
pub(crate) struct TokenUsageReader {
    index: Arc<Mutex<Index>>,
}
#[derive(Default)]
struct FileCache {
    path: Option<PathBuf>,
    offset: u64,
    len: u64,
    modified: Option<SystemTime>,
    identity: Option<SystemTime>,
    latest: Option<TokenUsage>,
    turns: HashMap<String, Option<u64>>,
    order: VecDeque<String>,
    discarding: bool,
    bytes_read: u64,
    directories: u64,
}
impl TokenUsageReader {
    fn read(&self, root: &Path, id: &str, turn: Option<&str>) -> Result<Option<TokenUsage>, String> {
        if !crate::session_id::is_filename_id(id) {
            return Err("会话 ID 格式无效".into());
        }
        let key = (root.to_path_buf(), id.to_string());
        let file = {
            let mut index = crate::sync_state::lock(&self.index);
            if let Some(file) = index.files.get(&key) {
                file.clone()
            } else {
                if index.files.len() >= MAX_SESSIONS {
                    if let Some(old) = index.order.pop_front() {
                        index.files.remove(&old);
                    }
                }
                let file: SharedFile = Arc::default();
                index.order.push_back(key.clone());
                index.files.insert(key, file.clone());
                file
            }
        };
        let mut cache = crate::sync_state::lock(&file);
        let result = cache.read(root, id, turn);
        if result.is_err() {
            *cache = FileCache::default();
        }
        result
    }
}
impl FileCache {
    fn remember(&mut self, turn: &str, value: Option<u64>) {
        if !self.turns.contains_key(turn) {
            if self.turns.len() >= MAX_TURNS {
                if let Some(old) = self.order.pop_front() {
                    self.turns.remove(&old);
                }
            }
            self.order.push_back(turn.into());
        }
        self.turns.insert(turn.into(), value);
    }
    fn read(&mut self, root: &Path, id: &str, turn: Option<&str>) -> Result<Option<TokenUsage>, String> {
        if self.path.as_ref().is_none_or(|p| !p.is_file()) {
            self.path = session_file(root, id, &mut self.directories)?;
            self.offset = 0;
            self.discarding = false;
            self.latest = None;
            self.turns.clear();
            self.order.clear();
        }
        let Some(path) = self.path.clone() else { return Ok(None) };
        let mut file = File::open(&path).map_err(|_| "打开 Codex 会话记录失败")?;
        let metadata = file.metadata().map_err(|_| "读取会话文件属性失败")?;
        let identity = metadata.created().ok();
        let modified = metadata.modified().ok();
        let len = metadata.len();
        if self.identity != identity || len < self.len || (len == self.len && self.modified != modified) {
            self.offset = 0;
            self.discarding = false;
            self.latest = None;
            self.turns.clear();
            self.order.clear();
        }
        if let Some(turn) = turn {
            if !self.turns.contains_key(turn) {
                self.remember(turn, None);
                self.offset = 0;
                self.discarding = false;
                self.latest = None;
            }
        }
        file.seek(SeekFrom::Start(self.offset))
            .map_err(|_| "定位会话记录失败")?;
        let mut reader = BufReader::new(file);
        loop {
            let start = self.offset;
            let mut line = Vec::new();
            let count = reader
                .by_ref()
                .take(MAX_RECORD_BYTES + 1)
                .read_until(b'\n', &mut line)
                .map_err(|_| "读取 Codex 会话记录失败")?;
            self.bytes_read += count as u64;
            if count == 0 {
                break;
            }
            if self.discarding || line.len() as u64 > MAX_RECORD_BYTES {
                self.discarding = !line.ends_with(b"\n");
                self.offset += count as u64;
                continue;
            }
            // 未写完的尾行下次从原偏移重读；完整但无换行的 JSON 保持旧协议可读。
            let complete = line.ends_with(b"\n");
            let value = serde_json::from_slice::<Value>(&line);
            if !complete && value.is_err() {
                self.offset = start;
                break;
            }
            self.offset += count as u64;
            if let Some((record_turn, usage)) = token_record(value.ok(), id) {
                if let Some(entry) = self.turns.get_mut(&record_turn) {
                    *entry = usage.task_tokens;
                }
                self.latest = Some(usage);
            }
            if !complete {
                self.offset = start;
                break;
            }
        }
        self.len = len;
        self.modified = modified;
        self.identity = identity;
        Ok(self.latest.as_ref().map(|latest| TokenUsage {
            task_tokens: turn.map_or(latest.task_tokens, |turn| self.turns.get(turn).copied().flatten()),
            session_tokens: latest.session_tokens,
        }))
    }
}
#[tauri::command]
pub async fn read_token_usage(
    state: tauri::State<'_, TokenUsageReader>,
    session_id: String,
    turn_id: Option<String>,
) -> Result<Option<TokenUsage>, String> {
    let root = codex_sessions_dir()?;
    let reader = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reader.read(&root, &session_id, turn_id.as_deref()))
        .await
        .map_err(|_| "后台查询 token 用量失败".to_string())?
}

#[cfg(test)]
fn parse_usage(
    reader: impl BufRead,
    session_id: &str,
    requested_turn: Option<&str>,
) -> Result<Option<TokenUsage>, String> {
    let mut latest_session_total = None;
    let mut task_tokens = None;
    for line in reader.lines() {
        let line = line.map_err(|error| format!("读取 Codex 会话记录失败：{error}"))?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("token_usage_record") {
            continue;
        }
        let Some(payload) = value.get("payload") else { continue };
        if payload.get("thread_id").and_then(Value::as_str) != Some(session_id) {
            continue;
        }
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else {
            continue;
        };
        let session_total = payload
            .pointer("/thread_token_usage/total_tokens")
            .and_then(Value::as_u64);
        let turn_total = payload
            .pointer("/turn_token_usage/total_tokens")
            .and_then(Value::as_u64);
        latest_session_total = Some(session_total);
        if requested_turn.is_none_or(|requested| requested == turn_id) {
            task_tokens = turn_total;
        }
    }
    Ok(latest_session_total.map(|session_tokens| TokenUsage {
        task_tokens,
        session_tokens,
    }))
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
        assert_eq!(
            parse_usage(Cursor::new(data), "s", None).unwrap().unwrap().task_tokens,
            Some(60)
        );
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

    fn record(turn: &str, task: u64, total: u64) -> String {
        format!(
            "{}\n",
            serde_json::json!({"type":"token_usage_record","payload":{"thread_id":"abc-123","turn_id":turn,"turn_token_usage":{"total_tokens":task},"thread_token_usage":{"total_tokens":total}}})
        )
    }
    #[test]
    fn incremental_io_old_turns_partial_lines_and_relocation() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            fs::create_dir_all(dir.path().join(format!("2025/{i:02}/01"))).unwrap();
        }
        let path = dir.path().join("2025/00/01/rollout-abc-123.jsonl");
        let mut data = record("old", 10, 10);
        for i in 0..20_000 {
            data.push_str(&format!(
                "{{\"type\":\"ignored\",\"padding\":\"{}\"}}\n",
                "x".repeat(80)
            ));
            if i == 10 {
                data.push_str("broken json\n");
            }
        }
        data.push_str(&record("new", 20, 30));
        fs::write(&path, &data).unwrap();
        let mut cache = FileCache::default();
        let first = cache.read(dir.path(), "abc-123", Some("old")).unwrap().unwrap();
        assert_eq!(first.task_tokens, Some(10));
        assert_eq!(first.session_tokens, Some(30));
        let baseline_bytes = cache.bytes_read;
        let directories = cache.directories;
        for _ in 0..5 {
            assert_eq!(
                cache.read(dir.path(), "abc-123", Some("old")).unwrap(),
                Some(first.clone())
            );
        }
        assert_eq!(cache.bytes_read, baseline_bytes);
        assert_eq!(cache.directories, directories);
        let partial = record("old", 15, 35);
        let cut = partial.len() / 2;
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(&partial.as_bytes()[..cut]).unwrap();
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("old"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(10)
        );
        file.write_all(&partial.as_bytes()[cut..]).unwrap();
        drop(file);
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("old"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(15)
        );
        println!("TOKEN_IO baseline_bytes={} repeated_full_scan_bytes={} cached_retry_bytes={} directories_first={} cached_retry_directories=0",baseline_bytes,baseline_bytes*5,cache.bytes_read-baseline_bytes,directories);
        let moved = dir.path().join("moved-abc-123.jsonl");
        fs::rename(&path, &moved).unwrap();
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("new"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(20)
        );
        fs::write(&moved, record("new", 2, 2)).unwrap();
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("new"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(2)
        );
        fs::remove_file(moved).unwrap();
        assert!(cache.read(dir.path(), "abc-123", Some("new")).unwrap().is_none());
    }
    #[test]
    fn custom_home_missing_home_date_hint_and_cache_bounds() {
        assert_eq!(
            sessions_dir(Some("custom".into()), Some("ignored".into())).unwrap(),
            PathBuf::from("custom/sessions")
        );
        assert!(sessions_dir(None, None).is_err());
        assert_eq!(
            date_hint("00000000-0000-7000-8000-000000000001"),
            Some(PathBuf::from("1970/01/01"))
        );
        let dir = tempfile::tempdir().unwrap();
        let reader = TokenUsageReader::default();
        for i in 0..1000 {
            reader.read(dir.path(), &format!("{i:x}"), None).unwrap();
        }
        assert_eq!(crate::sync_state::lock(&reader.index).files.len(), MAX_SESSIONS);
        let mut cache = FileCache::default();
        for i in 0..1000 {
            cache.remember(&i.to_string(), Some(i));
        }
        assert_eq!(cache.turns.len(), MAX_TURNS);
    }
    #[test]
    fn concurrent_queries_share_one_session_scan_and_home_keys_are_distinct() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        fs::write(first.path().join("r-abc-123.jsonl"), record("a", 3, 3)).unwrap();
        fs::write(second.path().join("r-abc-123.jsonl"), record("a", 9, 9)).unwrap();
        let reader = TokenUsageReader::default();
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    assert_eq!(
                        reader
                            .read(first.path(), "abc-123", Some("a"))
                            .unwrap()
                            .unwrap()
                            .task_tokens,
                        Some(3)
                    )
                });
            }
        });
        let index = crate::sync_state::lock(&reader.index);
        let cache = crate::sync_state::lock(index.files.values().next().unwrap());
        assert_eq!(
            cache.bytes_read,
            fs::metadata(first.path().join("r-abc-123.jsonl")).unwrap().len()
        );
        drop(cache);
        drop(index);
        assert_eq!(
            reader
                .read(second.path(), "abc-123", Some("a"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(9)
        );
    }

    #[test]
    fn skips_large_non_usage_rows_and_restarts_discard_state_on_new_turn() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("r-abc-123.jsonl");
        let huge = "x".repeat(MAX_RECORD_BYTES as usize + 50);
        fs::write(&path, format!("{huge}\n{}", record("a", 5, 5))).unwrap();
        let mut cache = FileCache::default();
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("a"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(5)
        );
        fs::write(&path, huge).unwrap();
        cache.read(dir.path(), "abc-123", Some("a")).unwrap();
        assert!(cache.discarding);
        fs::write(&path, record("b", 8, 8)).unwrap();
        assert_eq!(
            cache
                .read(dir.path(), "abc-123", Some("b"))
                .unwrap()
                .unwrap()
                .task_tokens,
            Some(8)
        );
    }
}
