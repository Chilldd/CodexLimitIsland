use super::{app_paths, diagnostics};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::{Path, PathBuf}};

/// 用户在托盘菜单里设置的持久化配置，保存在 app 目录的 config.json。
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    codex_path: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    Ok(app_paths::app_home_dir()?.join("config.json"))
}

fn load_at(path: &Path) -> Settings {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Settings::default(),
        Err(error) => {
            diagnostics::log("读取配置文件失败", Some(&error.to_string()));
            return Settings::default();
        }
    };
    match serde_json::from_str(&text) {
        Ok(settings) => settings,
        Err(error) => {
            diagnostics::log("配置文件无法解析，已忽略", Some(&error.to_string()));
            Settings::default()
        }
    }
}

fn write_at(path: &Path, text: &str) -> io::Result<()> {
    fs::create_dir_all(path.parent().ok_or_else(|| io::Error::other("配置目录无效"))?)?;
    fs::write(path, text)
}

/// 读取用户设置的 Codex 程序路径，不校验文件是否仍然存在。
pub fn configured_codex_path() -> Option<PathBuf> {
    let path = config_path().ok()?;
    load_at(&path)
        .codex_path
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn save_codex_path(codex_path: &Path) -> Result<(), String> {
    let path = config_path()?;
    let settings = Settings { codex_path: Some(codex_path.to_string_lossy().into_owned()) };
    let text = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("序列化配置失败：{error}"))?;
    write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
}

/// 删除配置文件即恢复默认查找；文件不存在时视为已恢复。
pub fn clear_codex_path() -> Result<(), String> {
    app_paths::clear_at(&config_path()?)
        .map_err(|error| format!("删除配置文件失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, time::{SystemTime, UNIX_EPOCH}};

    fn temp_path(name: &str) -> PathBuf {
        env::temp_dir()
            .join(format!("codexlimit-settings-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
            .join(name)
    }

    #[test]
    fn saves_and_reads_codex_path() {
        let path = temp_path("config.json");
        assert!(load_at(&path).codex_path.is_none());
        let settings = Settings { codex_path: Some(r"D:\Tools\codex.exe".into()) };
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();
        assert_eq!(load_at(&path).codex_path.as_deref(), Some(r"D:\Tools\codex.exe"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn broken_or_partial_config_falls_back_to_default() {
        let path = temp_path("config.json");
        write_at(&path, "{ 不是 JSON").unwrap();
        assert!(load_at(&path).codex_path.is_none());
        write_at(&path, "{\"unknown\": 1}").unwrap();
        assert!(load_at(&path).codex_path.is_none());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn clear_is_idempotent() {
        let path = temp_path("config.json");
        write_at(&path, "{}").unwrap();
        app_paths::clear_at(&path).unwrap();
        assert!(!path.exists());
        app_paths::clear_at(&path).unwrap();
    }
}
