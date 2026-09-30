use std::{ffi::c_void, io};

type Hwnd = *mut c_void;
type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;

const GWL_STYLE: i32 = -16;
const TITLE_BAR_STYLES: u32 = 0x00c0_0000 | 0x0004_0000 | 0x0008_0000 | 0x0002_0000 | 0x0001_0000;
const WM_STYLECHANGING: u32 = 0x007c;
const WM_NCDESTROY: u32 = 0x0082;
const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;
const SUBCLASS_ID: usize = 1;

// STYLESTRUCT 的成员是 32 位 DWORD，不能按指针宽度定义。
#[repr(C)]
struct StyleChange { old: u32, new: u32 }

#[link(name = "comctl32")]
unsafe extern "system" {
    #[link_name = "SetWindowSubclass"]
    fn set_window_subclass(hwnd: Hwnd, callback: SubclassProc, id: usize, data: usize) -> i32;
    #[link_name = "RemoveWindowSubclass"]
    fn remove_window_subclass(hwnd: Hwnd, callback: SubclassProc, id: usize) -> i32;
    #[link_name = "DefSubclassProc"]
    fn def_subclass_proc(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
}

#[link(name = "user32")]
unsafe extern "system" {
    #[link_name = "GetWindowLongPtrW"]
    fn get_window_long_ptr(hwnd: Hwnd, index: i32) -> isize;
    #[link_name = "SetWindowLongPtrW"]
    fn set_window_long_ptr(hwnd: Hwnd, index: i32, value: isize) -> isize;
    #[link_name = "SetWindowPos"]
    fn set_window_pos(hwnd: Hwnd, insert_after: Hwnd, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
}

unsafe extern "system" fn borderless_proc(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize, id: usize, _data: usize) -> isize {
    match message {
        WM_STYLECHANGING if wparam as i32 == GWL_STYLE && lparam != 0 => {
            let result = unsafe { def_subclass_proc(hwnd, message, wparam, lparam) };
            // Tao 更新内部窗口 flags 时会重新写入 WS_CAPTION；在样式生效前移除。
            unsafe { (*(lparam as *mut StyleChange)).new &= !TITLE_BAR_STYLES; }
            result
        }
        // 保留 Tao 的焦点事件，只禁止 DefWindowProc 重绘原生标题栏。
        WM_NCACTIVATE => unsafe { def_subclass_proc(hwnd, message, wparam, -1) },
        WM_NCPAINT => 0,
        WM_NCDESTROY => {
            if unsafe { remove_window_subclass(hwnd, borderless_proc, id) } == 0 {
                crate::diagnostics::log("移除窗口标题栏消息处理失败", None);
            }
            unsafe { def_subclass_proc(hwnd, message, wparam, lparam) }
        }
        _ => unsafe { def_subclass_proc(hwnd, message, wparam, lparam) },
    }
}

pub(super) fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    // setup 与窗口属于同一 UI 线程；Windows 不允许跨线程安装 subclass。
    install_on_hwnd(hwnd.0)?;
    refresh(window)
}

fn install_on_hwnd(hwnd: Hwnd) -> Result<(), String> {
    if unsafe { set_window_subclass(hwnd, borderless_proc, SUBCLASS_ID, 0) } == 0 {
        return Err("安装窗口标题栏消息处理失败".into());
    }
    Ok(())
}

pub(super) fn refresh(window: &tauri::WebviewWindow) -> Result<(), String> {
    const REFRESH_FRAME: u32 = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let style = unsafe { get_window_long_ptr(hwnd.0, GWL_STYLE) };
    if style == 0 {
        return Err(format!("读取窗口样式失败：{}", io::Error::last_os_error()));
    }
    if style & TITLE_BAR_STYLES as isize != 0 {
        if unsafe { set_window_long_ptr(hwnd.0, GWL_STYLE, style & !(TITLE_BAR_STYLES as isize)) } == 0 {
            return Err(format!("移除窗口标题栏失败：{}", io::Error::last_os_error()));
        }
    }
    if unsafe { set_window_pos(hwnd.0, std::ptr::null_mut(), 0, 0, 0, 0, REFRESH_FRAME) } == 0 {
        return Err(format!("刷新窗口边框失败：{}", io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GWL_EXSTYLE: i32 = -20;
    const OBSERVER_ID: usize = 2;
    const CUSTOM_MESSAGE: u32 = 0x8000 + 77;
    const FORWARDED_RESULT: isize = 0x713;

    #[link(name = "user32")]
    unsafe extern "system" {
        #[link_name = "CreateWindowExW"]
        fn create_window_ex(exstyle: u32, class: *const u16, title: *const u16, style: u32, x: i32, y: i32, width: i32, height: i32, parent: Hwnd, menu: Hwnd, instance: Hwnd, parameter: *mut c_void) -> Hwnd;
        #[link_name = "DestroyWindow"]
        fn destroy_window(hwnd: Hwnd) -> i32;
        #[link_name = "SendMessageW"]
        fn send_message(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[link(name = "comctl32")]
    unsafe extern "system" {
        #[link_name = "GetWindowSubclass"]
        fn get_window_subclass(hwnd: Hwnd, callback: SubclassProc, id: usize, data: *mut usize) -> i32;
    }

    #[derive(Default)]
    struct Observations {
        activations: [Option<(usize, isize)>; 2],
        activation_count: usize,
        ncpaint_count: usize,
        custom_message: Option<(usize, isize)>,
        destroyed: bool,
        borderless_removed_before_destroy: bool,
    }

    unsafe extern "system" fn observer_proc(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize, id: usize, data: usize) -> isize {
        // FFI 回调只记录观测结果，断言留在测试线程中，避免 panic 跨越原生边界。
        let observations = data as *mut Observations;
        match message {
            WM_NCACTIVATE => {
                unsafe {
                    let state = &mut *observations;
                    if let Some(slot) = state.activations.get_mut(state.activation_count) {
                        *slot = Some((wparam, lparam));
                    }
                    state.activation_count += 1;
                }
                FORWARDED_RESULT
            }
            WM_NCPAINT => {
                unsafe { (*observations).ncpaint_count += 1; }
                FORWARDED_RESULT
            }
            CUSTOM_MESSAGE => {
                unsafe { (*observations).custom_message = Some((wparam, lparam)); }
                FORWARDED_RESULT
            }
            WM_NCDESTROY => {
                let mut subclass_data = 0;
                let installed = unsafe { get_window_subclass(hwnd, borderless_proc, SUBCLASS_ID, &mut subclass_data) };
                unsafe {
                    (*observations).destroyed = true;
                    (*observations).borderless_removed_before_destroy = installed == 0;
                    remove_window_subclass(hwnd, observer_proc, id);
                    def_subclass_proc(hwnd, message, wparam, lparam)
                }
            }
            _ => unsafe { def_subclass_proc(hwnd, message, wparam, lparam) },
        }
    }

    struct TestWindow {
        hwnd: Hwnd,
        observations: Box<Observations>,
    }

    impl TestWindow {
        fn new() -> Self {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title = [0u16];
            // 不设置 WS_VISIBLE：测试使用独立隐藏窗口，不改变现有应用或桌面焦点。
            let hwnd = unsafe {
                create_window_ex(0x0000_0080, class.as_ptr(), title.as_ptr(), 0x8000_0000 | 0x0400_0000,
                    0, 0, 16, 16, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut())
            };
            assert!(!hwnd.is_null(), "创建隐藏测试窗口失败：{}", io::Error::last_os_error());
            let mut window = Self { hwnd, observations: Box::default() };
            let data = (&mut *window.observations as *mut Observations) as usize;
            assert_ne!(unsafe { set_window_subclass(hwnd, observer_proc, OBSERVER_ID, data) }, 0, "安装测试观测器失败");
            install_on_hwnd(hwnd).expect("安装无边框消息处理失败");
            window
        }

        fn destroy(&mut self) -> bool {
            if self.hwnd.is_null() { return true; }
            if unsafe { destroy_window(self.hwnd) } == 0 { return false; }
            self.hwnd = std::ptr::null_mut();
            true
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            // 原生销毁同步发送 WM_NCDESTROY，观测数据必须保留到销毁结束。
            if !self.destroy() {
                eprintln!("清理隐藏测试窗口失败：{}", io::Error::last_os_error());
            }
        }
    }

    #[test]
    fn prevents_native_title_repaint_without_blocking_focus_or_other_messages() {
        let mut window = TestWindow::new();
        let unrelated_styles = 0x8000_0000 | 0x0400_0000 | 0x0200_0000 | 0x0800_0000;
        assert_ne!(unsafe { set_window_long_ptr(window.hwnd, GWL_STYLE, (unrelated_styles | TITLE_BAR_STYLES) as isize) }, 0);
        assert_eq!(unsafe { get_window_long_ptr(window.hwnd, GWL_STYLE) } as u32, unrelated_styles,
            "标题栏样式应被过滤，其余窗口样式应保留");

        let unrelated_exstyles = 0x0000_0080 | 0x0000_0020;
        assert_ne!(unsafe { set_window_long_ptr(window.hwnd, GWL_EXSTYLE, unrelated_exstyles as isize) }, 0);
        assert_eq!(unsafe { get_window_long_ptr(window.hwnd, GWL_EXSTYLE) } as u32, unrelated_exstyles,
            "扩展窗口样式不应被过滤");

        for active in [0, 1] {
            assert_eq!(unsafe { send_message(window.hwnd, WM_NCACTIVATE, active, 42) }, FORWARDED_RESULT,
                "激活消息应保留下层处理结果");
        }
        assert_eq!(window.observations.activation_count, 2);
        assert_eq!(window.observations.activations, [Some((0, -1)), Some((1, -1))],
            "失焦和获焦均应转发状态且禁止原生非客户区重绘");

        let paints_before = window.observations.ncpaint_count;
        assert_eq!(unsafe { send_message(window.hwnd, WM_NCPAINT, 1, 0) }, 0);
        assert_eq!(window.observations.ncpaint_count, paints_before, "原生非客户区绘制不应进入下层");
        assert_eq!(unsafe { send_message(window.hwnd, CUSTOM_MESSAGE, 17, -23) }, FORWARDED_RESULT);
        assert_eq!(window.observations.custom_message, Some((17, -23)), "其他消息应完整转发");

        assert!(window.destroy(), "销毁隐藏测试窗口失败：{}", io::Error::last_os_error());
        assert!(window.observations.destroyed, "销毁通知应进入下层");
        assert!(window.observations.borderless_removed_before_destroy, "销毁通知转发前应移除无边框处理器");
    }
}
