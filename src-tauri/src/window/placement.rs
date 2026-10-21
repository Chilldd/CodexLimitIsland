pub(crate) fn center_x(origin_x: i32, screen_width: u32, scale_factor: f64) -> i32 {
    let width = (390.0 * scale_factor) as i32;
    origin_x + (screen_width as i32 - width) / 2
}

pub(crate) fn clamp_x(x: i32, origin_x: i32, screen_width: u32, scale_factor: f64) -> i32 {
    let width = (390.0 * scale_factor) as i32;
    let max_x = (origin_x + screen_width as i32 - width).max(origin_x);
    x.clamp(origin_x, max_x)
}

pub(crate) fn place_initial(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let screen = monitor.size();
        let origin = monitor.position();
        let scale = monitor.scale_factor();
        let top = (3.0 * scale) as i32;
        let x = match crate::settings::configured_window_x() {
            Some(saved_x) => clamp_x(saved_x, origin.x, screen.width, scale),
            None => center_x(origin.x, screen.width, scale),
        };
        window.set_position(tauri::PhysicalPosition::new(x, origin.y + top))?;
    }

    Ok(())
}

pub(crate) fn place_center(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let screen = monitor.size();
        let origin = monitor.position();
        let scale = monitor.scale_factor();
        let top = (3.0 * scale) as i32;
        let x = center_x(origin.x, screen.width, scale);
        window.set_position(tauri::PhysicalPosition::new(x, origin.y + top))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_window_on_primary_and_secondary_screens() {
        assert_eq!(center_x(0, 1920, 1.0), 765);
        assert_eq!(center_x(0, 3840, 2.0), 1530);
        assert_eq!(center_x(-1920, 1920, 1.0), -1155);
    }

    #[test]
    fn clamps_x_within_screen_bounds() {
        assert_eq!(clamp_x(500, 0, 1920, 1.0), 500);
        assert_eq!(clamp_x(-100, 0, 1920, 1.0), 0);
        assert_eq!(clamp_x(2000, 0, 1920, 1.0), 1530);

        assert_eq!(clamp_x(-1000, -1920, 1920, 1.0), -1000);
        assert_eq!(clamp_x(-2500, -1920, 1920, 1.0), -1920);
        assert_eq!(clamp_x(0, -1920, 1920, 1.0), -390);

        assert_eq!(clamp_x(100, 0, 200, 1.0), 0);
    }
}
