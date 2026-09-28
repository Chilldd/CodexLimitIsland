use super::{diagnostics, settings};
use std::{env, ffi::OsStr, path::PathBuf};
#[cfg(any(windows, target_os = "macos"))]
use std::path::Path;

pub fn find_codex_runtime() -> Result<PathBuf, String> {
    if let Some(path) = usable_configured_path(settings::configured_codex_path()) {
        return Ok(path);
    }

    #[cfg(windows)]
    if let Some(path) = windows_app_runtime(env::var_os("LOCALAPPDATA").as_deref()) {
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    if let Some(path) = macos_app_runtime(env::var_os("HOME").as_deref()) {
        return Ok(path);
    }

    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    find_on_path(env::var_os("PATH").as_deref(), name)
        .ok_or_else(|| "未找到 Codex 可执行程序；请安装 Codex CLI、加入 PATH，或在托盘菜单中设置 Codex 程序路径".to_string())
}

/// 校验托盘菜单中设置的路径；文件已被移动或删除时回退到自动查找。
fn usable_configured_path(configured: Option<PathBuf>) -> Option<PathBuf> {
    match configured {
        Some(path) if path.is_file() => Some(path),
        Some(path) => {
            diagnostics::log("自定义 Codex 路径无效，回退自动查找", Some(&path.display().to_string()));
            None
        }
        None => None,
    }
}

#[cfg(target_os = "macos")]
fn macos_app_runtime(home: Option<&OsStr>) -> Option<PathBuf> {
    let user_app = home.map(|value| Path::new(value).join("Applications/Codex.app/Contents/Resources/codex"));
    user_app.into_iter()
        .chain([PathBuf::from("/Applications/Codex.app/Contents/Resources/codex")])
        .find(|path| path.is_file())
}

fn find_on_path(path_value: Option<&OsStr>, name: &str) -> Option<PathBuf> {
    env::split_paths(path_value?).map(|directory| directory.join(name)).find(|path| path.is_file())
}

#[cfg(windows)]
fn windows_app_runtime(local_app_data: Option<&OsStr>) -> Option<PathBuf> {
    use std::fs;
    let root = Path::new(local_app_data?).join("OpenAI").join("Codex").join("bin");
    let mut candidates = fs::read_dir(root).ok()?.filter_map(Result::ok)
        .map(|entry| entry.path().join("codex.exe"))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| fs::metadata(path).and_then(|value| value.modified()).ok());
    candidates.pop()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn finds_codex_on_path() {
        let dir = env::temp_dir().join(format!("codexlimit-runtime-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let name = if cfg!(windows) { "codex.exe" } else { "codex" };
        let executable = dir.join(name);
        fs::File::create(&executable).unwrap();
        let path_value = env::join_paths([dir.as_path()]).unwrap();
        assert_eq!(find_on_path(Some(&path_value), name), Some(executable));
        assert_eq!(find_on_path(None, name), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn prefers_windows_app_runtime_when_present() {
        let dir = env::temp_dir().join(format!("codexlimit-app-runtime-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let binary = dir.join("OpenAI").join("Codex").join("bin").join("version").join("codex.exe");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::File::create(&binary).unwrap();
        assert_eq!(windows_app_runtime(Some(dir.as_os_str())), Some(binary));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn configured_path_wins_only_when_it_exists() {
        let dir = env::temp_dir().join(format!("codexlimit-configured-runtime-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let binary = dir.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        fs::File::create(&binary).unwrap();
        assert_eq!(usable_configured_path(Some(binary.clone())), Some(binary));
        assert_eq!(usable_configured_path(Some(dir.join("missing"))), None);
        assert_eq!(usable_configured_path(None), None);
        fs::remove_dir_all(dir).unwrap();
    }
}
