#[cfg(windows)]
use super::frame;
#[cfg(windows)]
use std::io;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    CreateRectRgn as create_rect_rgn, DeleteObject as delete_object, SetWindowRgn as set_window_rgn,
};
#[tauri::command]
pub(crate) fn set_window_hit_region(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if !valid_hit_region(width, height, cfg!(debug_assertions)) {
        return Err("窗口点击区域超出允许范围".into());
    }
    apply_window_hit_region(window, width, height)
}

pub(crate) fn valid_hit_region(width: f64, height: f64, development: bool) -> bool {
    width.is_finite()
        && height.is_finite()
        && (100.0..=390.0).contains(&width)
        && ((40.0..=444.0).contains(&height) || (development && width == 384.0 && height == 550.0))
}

#[cfg(windows)]
pub(crate) fn keep_window_borderless(window: &tauri::WebviewWindow) -> Result<(), String> {
    frame::refresh(window)
}

#[cfg(windows)]
fn apply_window_hit_region(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let region_width = (width * scale).round() as i32;
    let region_height = (height * scale).round() as i32;
    let left = (size.width as i32 - region_width) / 2;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let region = unsafe { create_rect_rgn(left, 0, left + region_width, region_height) };
    if region.is_null() {
        return Err(format!("点击区域创建失败：{}", io::Error::last_os_error()));
    }
    // 可见窗口更新裁剪区域时立即重绘，避免收缩后残留原生窗口画面。
    if unsafe { set_window_rgn(hwnd.0, region, 1) } == 0 {
        let error = io::Error::last_os_error();
        unsafe {
            delete_object(region);
        }
        return Err(format!("窗口点击区域调整失败：{error}"));
    }
    keep_window_borderless(&window)?;
    Ok(())
}

#[cfg(not(windows))]
fn apply_window_hit_region(_window: tauri::WebviewWindow, _width: f64, _height: f64) -> Result<(), String> {
    // 原生点击区域裁剪仅在 Windows 实现；其他平台先保持完整窗口可交互。
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hit_region_bounds_keep_debug_exception_out_of_release() {
        for (width, height) in [(100.0, 40.0), (168.0, 42.0), (384.0, 444.0)] {
            assert!(valid_hit_region(width, height, false));
        }
        assert!(valid_hit_region(384.0, 550.0, true));
        assert!(!valid_hit_region(384.0, 550.0, false));
        for (width, height) in [
            (390.0, 550.0),
            (384.0, 445.0),
            (99.0, 40.0),
            (391.0, 42.0),
            (100.0, 39.0),
            (f64::NAN, 42.0),
            (100.0, f64::INFINITY),
        ] {
            assert!(!valid_hit_region(width, height, true));
        }
    }
}
