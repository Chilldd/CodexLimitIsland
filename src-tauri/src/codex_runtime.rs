use super::{diagnostics, settings};
#[cfg(any(windows, target_os = "macos"))]
use std::path::Path;
use std::{env, ffi::OsStr, path::PathBuf};

pub fn find_codex_runtime() -> Result<PathBuf, String> {
    if let Some(path) = usable_configured_path(settings::configured_codex_path()) {
        return Ok(path);
    }
    find_auto_codex_runtime()
}

pub(crate) fn find_auto_codex_runtime() -> Result<PathBuf, String> {
    #[cfg(windows)]
    if let Some(path) = windows_app_runtime(env::var_os("LOCALAPPDATA").as_deref()) {
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    if let Some(path) = macos_app_runtime(env::var_os("HOME").as_deref()) {
        return Ok(path);
    }

    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    find_on_path(env::var_os("PATH").as_deref(), name).ok_or_else(|| {
        "未找到 Codex 可执行程序；请先启动 Codex App 后重试自动搜索，或安装 Codex CLI 并加入 PATH".to_string()
    })
}

/// 校验托盘菜单中设置的路径；文件已被移动或删除时回退到自动查找。
fn usable_configured_path(configured: Option<PathBuf>) -> Option<PathBuf> {
    match configured {
        Some(path) if path.is_file() => Some(resolve_codex_executable(path)),
        Some(_) => {
            diagnostics::log("自定义 Codex 路径无效，回退自动查找", None);
            None
        }
        None => None,
    }
}

/// 桌面入口与 CLI 分开打包时，优先使用入口旁的内置 CLI。
pub(crate) fn resolve_codex_executable(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    if let Some(runtime) = windows_bundled_runtime(&path) {
        return runtime;
    }
    path
}

#[cfg(windows)]
fn windows_bundled_runtime(executable: &Path) -> Option<PathBuf> {
    let name = executable.file_name()?.to_str()?;
    if !name.eq_ignore_ascii_case("codex.exe") && !name.eq_ignore_ascii_case("chatgpt.exe") {
        return None;
    }
    let runtime = executable.parent()?.join("resources").join("codex.exe");
    runtime.is_file().then_some(runtime)
}

#[cfg(target_os = "macos")]
fn macos_app_runtime(home: Option<&OsStr>) -> Option<PathBuf> {
    let user_app = home.map(|value| Path::new(value).join("Applications/Codex.app/Contents/Resources/codex"));
    user_app
        .into_iter()
        .chain([PathBuf::from("/Applications/Codex.app/Contents/Resources/codex")])
        .find(|path| path.is_file())
}

fn find_on_path(path_value: Option<&OsStr>, name: &str) -> Option<PathBuf> {
    env::split_paths(path_value?)
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .map(resolve_codex_executable)
}

#[cfg(windows)]
fn windows_app_runtime(local_app_data: Option<&OsStr>) -> Option<PathBuf> {
    use std::fs;
    let root = local_app_data.map(Path::new);
    let mut candidates = root
        .and_then(|root| fs::read_dir(root.join("OpenAI/Codex/bin")).ok())
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("codex.exe"))
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| fs::metadata(path).and_then(|value| value.modified()).ok());
    candidates
        .pop()
        .or_else(|| {
            root.and_then(|root| {
                [
                    "OpenAI/Codex/resources/codex.exe",
                    "OpenAI/Codex/app/resources/codex.exe",
                    "Programs/Codex/resources/codex.exe",
                    "Programs/Codex/app/resources/codex.exe",
                ]
                .into_iter()
                .map(|relative| root.join(relative))
                .find(|path| path.is_file())
            })
        })
        .or_else(windows_running_app_runtime)
}

#[cfg(windows)]
fn windows_running_app_runtime() -> Option<PathBuf> {
    use std::{mem::size_of, os::windows::ffi::OsStringExt};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
            },
            Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    };

    // 通过进程定位便携版和 Store 安装，不扫描用户磁盘或读取命令行。
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut runtime = None;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let name_len = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
        if name.eq_ignore_ascii_case("codex.exe") || name.eq_ignore_ascii_case("chatgpt.exe") {
            let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
            if !process.is_null() {
                let mut buffer = vec![0u16; 32768];
                let mut len = buffer.len() as u32;
                if unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut len) } != 0 {
                    let executable = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len as usize]));
                    runtime = windows_bundled_runtime(&executable);
                }
                unsafe { CloseHandle(process) };
            }
        }
        if runtime.is_some() {
            break;
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    runtime
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn finds_codex_on_path() {
        let dir = env::temp_dir().join(format!(
            "codexlimit-runtime-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
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
        let dir = env::temp_dir().join(format!(
            "codexlimit-app-runtime-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let binary = dir
            .join("OpenAI")
            .join("Codex")
            .join("bin")
            .join("version")
            .join("codex.exe");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::File::create(&binary).unwrap();
        let bundled = dir.join("OpenAI/Codex/app/resources/codex.exe");
        fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        fs::File::create(bundled).unwrap();
        assert_eq!(windows_app_runtime(Some(dir.as_os_str())), Some(binary));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn finds_windows_bundled_runtime_without_bin_cache() {
        for layout in [
            "OpenAI/Codex/resources/codex.exe",
            "OpenAI/Codex/app/resources/codex.exe",
            "Programs/Codex/resources/codex.exe",
            "Programs/Codex/app/resources/codex.exe",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let binary = dir.path().join(layout);
            fs::create_dir_all(binary.parent().unwrap()).unwrap();
            fs::File::create(&binary).unwrap();
            assert_eq!(windows_app_runtime(Some(dir.path().as_os_str())), Some(binary));
        }
    }

    #[cfg(windows)]
    #[test]
    fn resolves_selected_and_path_desktop_entries_in_unicode_directory() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("Codex 【免安装版】 【适合大多数电脑】/app");
        let binary = app.join("resources/codex.exe");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::File::create(&binary).unwrap();
        let path_value = env::join_paths([app.as_path()]).unwrap();
        for name in ["Codex.exe", "ChatGPT.exe"] {
            let desktop = app.join(name);
            fs::File::create(&desktop).unwrap();
            assert_eq!(resolve_codex_executable(desktop.clone()), binary);
            assert_eq!(usable_configured_path(Some(desktop)), Some(binary.clone()));
            assert_eq!(find_on_path(Some(&path_value), name), Some(binary.clone()));
        }
        assert_eq!(resolve_codex_executable(binary.clone()), binary);
    }

    #[cfg(windows)]
    #[test]
    fn preserves_explicit_executable_without_bundled_cli() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("codex.exe");
        fs::File::create(&executable).unwrap();
        assert_eq!(resolve_codex_executable(executable.clone()), executable);
        fs::create_dir_all(dir.path().join("resources/codex.exe")).unwrap();
        assert_eq!(resolve_codex_executable(executable.clone()), executable);
    }

    #[cfg(windows)]
    #[test]
    fn does_not_redirect_unrelated_executable() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("resources/codex.exe");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::File::create(binary).unwrap();
        let executable = dir.path().join("other.exe");
        fs::File::create(&executable).unwrap();
        assert_eq!(resolve_codex_executable(executable.clone()), executable);
    }

    #[test]
    fn configured_path_wins_only_when_it_exists() {
        let dir = env::temp_dir().join(format!(
            "codexlimit-configured-runtime-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let binary = dir.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        fs::File::create(&binary).unwrap();
        assert_eq!(usable_configured_path(Some(binary.clone())), Some(binary));
        assert_eq!(usable_configured_path(Some(dir.join("missing"))), None);
        assert_eq!(usable_configured_path(None), None);
        fs::remove_dir_all(dir).unwrap();
    }
}
