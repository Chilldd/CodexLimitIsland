use super::{app_paths, diagnostics};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

/// 灵动岛胶囊展示的限额窗口偏好：5 小时或每周。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub enum LimitDisplayWindow {
    #[default]
    FiveHour,
    Week,
}

/// 用户在托盘菜单里设置的持久化配置，保存在 app 目录的 config.json。
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    codex_path: Option<String>,
    limit_window: Option<LimitDisplayWindow>,
    window_x: Option<i32>,
}

impl Settings {
    fn is_empty(&self) -> bool {
        self.codex_path.is_none() && self.limit_window.is_none() && self.window_x.is_none()
    }
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
    let mut settings = load_at(&path);
    settings.codex_path = Some(codex_path.to_string_lossy().into_owned());
    let text = serde_json::to_string_pretty(&settings).map_err(|error| format!("序列化配置失败：{error}"))?;
    write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
}

/// 清除自定义路径恢复默认查找；若无其它配置则删除文件。
pub fn clear_codex_path() -> Result<(), String> {
    let path = config_path()?;
    let mut settings = load_at(&path);
    settings.codex_path = None;
    if settings.is_empty() {
        app_paths::clear_at(&path).map_err(|error| format!("删除配置文件失败：{error}"))
    } else {
        let text = serde_json::to_string_pretty(&settings).map_err(|error| format!("序列化配置失败：{error}"))?;
        write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
    }
}

/// 读取用户保存的窗口横坐标位置。
pub fn configured_window_x() -> Option<i32> {
    let path = config_path().ok()?;
    load_at(&path).window_x
}

pub fn save_window_x(x: i32) -> Result<(), String> {
    let path = config_path()?;
    let mut settings = load_at(&path);
    settings.window_x = Some(x);
    let text = serde_json::to_string_pretty(&settings).map_err(|error| format!("序列化配置失败：{error}"))?;
    write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
}

pub fn clear_window_x() -> Result<(), String> {
    let path = config_path()?;
    let mut settings = load_at(&path);
    settings.window_x = None;
    if settings.is_empty() {
        app_paths::clear_at(&path).map_err(|error| format!("删除配置文件失败：{error}"))
    } else {
        let text = serde_json::to_string_pretty(&settings).map_err(|error| format!("序列化配置失败：{error}"))?;
        write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
    }
}

#[tauri::command]
pub fn save_window_position(x: i32) -> Result<(), String> {
    save_window_x(x)
}

/// 读取用户偏好的限额展示窗口，默认为 5 小时限额。
pub fn limit_display_window() -> LimitDisplayWindow {
    let path = match config_path() {
        Ok(path) => path,
        Err(_) => return LimitDisplayWindow::default(),
    };
    load_at(&path).limit_window.unwrap_or_default()
}

pub fn save_limit_display_window(window: LimitDisplayWindow) -> Result<(), String> {
    let path = config_path()?;
    let mut settings = load_at(&path);
    settings.limit_window = Some(window);
    let text = serde_json::to_string_pretty(&settings).map_err(|error| format!("序列化配置失败：{error}"))?;
    write_at(&path, &text).map_err(|error| format!("写入配置文件失败：{error}"))
}

#[tauri::command]
pub fn read_limit_display_window() -> LimitDisplayWindow {
    limit_display_window()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_path(name: &str) -> PathBuf {
        env::temp_dir()
            .join(format!(
                "codexlimit-settings-test-{}-{}",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
            ))
            .join(name)
    }

    #[test]
    fn saves_and_reads_codex_path() {
        let path = temp_path("config.json");
        assert!(load_at(&path).codex_path.is_none());
        let settings = Settings {
            codex_path: Some(r"D:\Tools\codex.exe".into()),
            limit_window: None,
            window_x: None,
        };
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

    #[test]
    fn saves_and_reads_limit_display_window() {
        let path = temp_path("config.json");
        assert_eq!(load_at(&path).limit_window, None);
        let settings = Settings {
            codex_path: None,
            limit_window: Some(LimitDisplayWindow::Week),
            window_x: None,
        };
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();
        assert_eq!(load_at(&path).limit_window, Some(LimitDisplayWindow::Week));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn preserves_both_settings_when_saving_individually() {
        let path = temp_path("config.json");
        let mut settings = Settings {
            codex_path: Some(r"D:\Tools\codex.exe".into()),
            limit_window: Some(LimitDisplayWindow::Week),
            window_x: None,
        };
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        settings.codex_path = None;
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();
        let loaded = load_at(&path);
        assert_eq!(loaded.codex_path, None);
        assert_eq!(loaded.limit_window, Some(LimitDisplayWindow::Week));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn saves_reads_and_clears_window_x_coexisting_with_other_settings() {
        let path = temp_path("config.json");
        assert_eq!(load_at(&path).window_x, None);

        let mut settings = Settings {
            codex_path: Some(r"D:\Tools\codex.exe".into()),
            limit_window: Some(LimitDisplayWindow::FiveHour),
            window_x: Some(420),
        };
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        let loaded = load_at(&path);
        assert_eq!(loaded.window_x, Some(420));
        assert_eq!(loaded.codex_path.as_deref(), Some(r"D:\Tools\codex.exe"));
        assert_eq!(loaded.limit_window, Some(LimitDisplayWindow::FiveHour));

        // 清除 window_x 但保留其它设置时，配置文件依然存在
        settings.window_x = None;
        assert!(!settings.is_empty());
        write_at(&path, &serde_json::to_string_pretty(&settings).unwrap()).unwrap();

        let loaded_after = load_at(&path);
        assert_eq!(loaded_after.window_x, None);
        assert_eq!(loaded_after.codex_path.as_deref(), Some(r"D:\Tools\codex.exe"));

        // 所有配置全为 None 时 is_empty 返回 true
        settings.codex_path = None;
        settings.limit_window = None;
        assert!(settings.is_empty());

        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
