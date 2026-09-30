fn session_uri(session_id: &str) -> Result<String, String> {
    // 链接只接受单个 UUID，避免 Hook 字段改变 URI 路径、查询参数或协议。
    if session_id.len() != 36
        || !session_id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("会话 ID 格式无效，无法打开 Codex 对话".into());
    }
    Ok(format!("codex://threads/{session_id}"))
}

#[tauri::command]
pub async fn open_codex_session(session_id: String) -> Result<(), String> {
    let uri = session_uri(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || open_uri(&uri))
        .await
        .map_err(|error| format!("后台打开 Codex 会话失败：{error}"))?
}

#[cfg(any(windows, test))]
fn shell_execute_result(code: isize) -> Result<(), String> {
    if code > 32 {
        return Ok(());
    }
    let reason = match code {
        0 | 8 => "系统内存或资源不足",
        2 => "找不到 Codex 程序",
        3 => "找不到 Codex 程序路径",
        5 => "系统拒绝访问",
        26 => "程序正在被其他进程占用",
        27 => "链接协议配置不完整",
        28 => "打开请求超时",
        29 => "打开请求失败",
        30 => "Codex 程序繁忙",
        31 => "未注册 Codex 链接协议，请安装或修复 Codex App",
        32 => "缺少程序所需的动态链接库",
        _ => "系统无法处理链接",
    };
    Err(format!(
        "打开 Codex 会话失败：{reason}（系统错误码：{code}）"
    ))
}

#[cfg(windows)]
fn open_uri(uri: &str) -> Result<(), String> {
    windows::open_uri(uri)
}

#[cfg(windows)]
mod windows {
    use std::{ffi::c_void, ptr};

    #[link(name = "shell32")]
    unsafe extern "system" {
        #[link_name = "ShellExecuteW"]
        fn shell_execute(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> *mut c_void;
    }

    #[link(name = "ole32")]
    unsafe extern "system" {
        #[link_name = "CoInitializeEx"]
        fn co_initialize(reserved: *mut c_void, flags: u32) -> i32;
        #[link_name = "CoUninitialize"]
        fn co_uninitialize();
    }

    struct ComApartment;
    impl ComApartment {
        fn initialize() -> Result<Self, String> {
            // Shell 扩展可能使用 COM；初始化和释放必须发生在同一个后台线程。
            let code = unsafe { co_initialize(ptr::null_mut(), 0x2 | 0x4) }; // STA | DISABLE_OLE1DDE
            if code < 0 {
                return Err(format!(
                    "初始化 Codex 链接处理失败（COM 错误码：0x{:08X}）",
                    code as u32
                ));
            }
            Ok(Self)
        }
    }
    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe {
                co_uninitialize();
            }
        }
    }

    pub(super) fn open_uri(uri: &str) -> Result<(), String> {
        let _apartment = ComApartment::initialize()?;
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let file: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
        let code = unsafe {
            shell_execute(
                ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                ptr::null(),
                ptr::null(),
                1,
            )
        } as isize;
        super::shell_execute_result(code)
    }
}

#[cfg(target_os = "macos")]
fn open_uri(uri: &str) -> Result<(), String> {
    // 捕获输出，避免系统在协议处理失败时将含会话 ID 的链接写入日志。
    let output = std::process::Command::new("/usr/bin/open")
        .arg(uri)
        .output()
        .map_err(|error| format!("打开 Codex 会话失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    match output.status.code() {
        Some(code) => Err(format!("打开 Codex 会话失败（open 退出码：{code}）")),
        None => Err("打开 Codex 会话失败：系统链接处理进程被信号终止".into()),
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn open_uri(_uri: &str) -> Result<(), String> {
    Err("当前平台暂不支持打开 Codex 对话".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a Codex App protocol handler and CODEX_THREAD_ID"]
    fn opens_current_codex_app_thread() {
        let id = std::env::var("CODEX_THREAD_ID").expect("当前 Codex 对话 ID 不可用");
        open_uri(&session_uri(&id).unwrap()).unwrap();
    }

    #[test]
    fn accepts_only_uuid_path_segments() {
        for id in [
            "01234567-89ab-cdef-0123-456789abcdef",
            "01234567-89AB-CDEF-0123-456789ABCDEF",
        ] {
            assert_eq!(session_uri(id).unwrap(), format!("codex://threads/{id}"));
        }
    }

    #[test]
    fn rejects_uri_control_characters_and_malformed_ids() {
        for id in [
            "",
            "s",
            "0123456789abcdef0123456789abcdef",
            "01234567_89ab-cdef-0123-456789abcdef",
            "01234567-89ab-cdef-0123-456789abcde/",
            "01234567-89ab-cdef-0123-456789abcde?",
            "01234567-89ab-cdef-0123-456789abcde#",
            "01234567-89ab-cdef-0123-456789abcde\0",
            "01234567-89ab-cdef-0123-456789abcdeé",
            "../threads/01234567-89ab-cdef-0123-456789abcdef",
            "01234567-89ab-cdef-0123-456789abcdef?view=review",
        ] {
            assert!(session_uri(id).is_err(), "unexpected accepted ID: {id:?}");
        }
    }

    #[test]
    fn shell_success_starts_above_32_and_reports_protocol_error() {
        for code in [0, 2, 3, 5, 8, 31, 32] {
            assert!(shell_execute_result(code).is_err());
        }
        assert!(shell_execute_result(33).is_ok());
        assert!(shell_execute_result(1024).is_ok());
        let missing_protocol = shell_execute_result(31).unwrap_err();
        assert!(missing_protocol.contains("未注册 Codex 链接协议"));
        assert!(missing_protocol.contains("错误码：31"));
    }
}
