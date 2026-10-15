use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

pub fn app_home_dir() -> Result<PathBuf, String> {
    app_home_from(env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
}
fn app_home_from(home: Option<std::ffi::OsString>) -> Result<PathBuf, String> {
    let home = home.filter(|value| !value.is_empty()).ok_or("无法确定用户 Home 目录")?;
    Ok(PathBuf::from(home).join(".codex-limit-island"))
}

pub fn suppress_auto_start_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("suppress-auto-start"))
}

fn suppress_at(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path.parent().ok_or_else(|| io::Error::other("退出标记目录无效"))?)?;
    fs::File::create(path)?;
    Ok(())
}

/// 删除文件；文件不存在时视为成功。
pub(super) fn clear_at(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn is_suppressed_at(path: &Path) -> io::Result<bool> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

pub fn suppress_auto_start() -> Result<(), String> {
    suppress_at(&suppress_auto_start_path()?).map_err(|_| "创建退出标记失败".into())
}

pub fn clear_suppress_auto_start() -> Result<(), String> {
    clear_at(&suppress_auto_start_path()?).map_err(|_| "清除退出标记失败".into())
}

pub fn is_auto_start_suppressed() -> Result<bool, String> {
    suppress_auto_start_path()
        .and_then(|path| is_suppressed_at(&path).map_err(|error| format!("读取退出标记失败：{:?}", error.kind())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn marker_lifecycle_and_missing_marker() {
        let dir = env::temp_dir().join(format!(
            "codexlimit-path-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let path = dir.join("nested").join("suppress-auto-start");
        assert!(!is_suppressed_at(&path).unwrap());
        clear_at(&path).unwrap();
        suppress_at(&path).unwrap();
        assert!(is_suppressed_at(&path).unwrap());
        clear_at(&path).unwrap();
        assert!(!is_suppressed_at(&path).unwrap());
        clear_at(&path).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unreadable_marker_is_an_error() {
        assert!(is_suppressed_at(Path::new("invalid\0marker")).is_err());
        assert!(suppress_at(Path::new("invalid\0marker")).is_err());
        assert!(clear_at(Path::new("invalid\0marker")).is_err());
    }
    #[test]
    fn missing_home_is_an_explicit_error() {
        assert!(app_home_from(None).is_err());
        assert!(app_home_from(Some("".into())).is_err());
        assert_eq!(
            app_home_from(Some("fake-home".into())).unwrap(),
            PathBuf::from("fake-home/.codex-limit-island")
        );
    }
}
