pub(crate) fn center_x(origin_x: i32, screen_width: u32, scale_factor: f64) -> i32 {
    let width = (390.0 * scale_factor) as i32;
    origin_x + (screen_width as i32 - width) / 2
}

pub(crate) fn clamp_x(x: i32, origin_x: i32, screen_width: u32, scale_factor: f64) -> i32 {
    let width = (390.0 * scale_factor) as i32;
    let max_x = (origin_x + screen_width as i32 - width).max(origin_x);
    x.clamp(origin_x, max_x)
}

#[derive(Clone, Copy)]
struct Screen {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

impl From<&tauri::Monitor> for Screen {
    fn from(monitor: &tauri::Monitor) -> Self {
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale: monitor.scale_factor(),
        }
    }
}

fn restored_position(saved: (Option<i32>, Option<i32>), screens: &[Screen], primary: Screen) -> (i32, i32) {
    if let Some(x) = saved.0 {
        if let Some(screen) = std::iter::once(&primary).chain(screens).find(|screen| {
            x >= screen.x
                && x < screen.x + screen.width as i32
                && saved
                    .1
                    .is_none_or(|y| y >= screen.y && y < screen.y + screen.height as i32)
        }) {
            return (
                clamp_x(x, screen.x, screen.width, screen.scale),
                screen.y + (3.0 * screen.scale).round() as i32,
            );
        }
    }
    (
        center_x(primary.x, primary.width, primary.scale),
        primary.y + (3.0 * primary.scale).round() as i32,
    )
}

pub(crate) fn place_initial(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(primary) = window.primary_monitor()? {
        let screens: Vec<Screen> = window.available_monitors()?.iter().map(Screen::from).collect();
        let (x, y) = restored_position(
            crate::settings::configured_window_position(),
            &screens,
            Screen::from(&primary),
        );
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

pub(crate) fn place_center(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let screen = monitor.size();
        let origin = monitor.position();
        let scale = monitor.scale_factor();
        let top = (3.0 * scale).round() as i32;
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

    #[test]
    fn restores_secondary_screens_and_falls_back_when_disconnected() {
        let primary = Screen {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 1.0,
        };
        let right = Screen {
            x: 1920,
            y: 240,
            width: 2560,
            height: 1440,
            scale: 2.0,
        };
        let left = Screen {
            x: -2560,
            y: -120,
            scale: 1.25,
            ..right
        };
        let above = Screen {
            x: 0,
            y: -1080,
            ..primary
        };
        let screens = [primary, right, left, above];
        assert_eq!(
            restored_position((Some(2000), Some(246)), &screens, primary),
            (2000, 246)
        );
        assert_eq!(
            restored_position((Some(-1050), Some(-116)), &screens, primary),
            (-1050, -116)
        );
        assert_eq!(
            restored_position((Some(500), Some(-1077)), &screens, primary),
            (500, -1077)
        );
        assert_eq!(
            restored_position((Some(4300), Some(246)), &screens, primary),
            (3700, 246)
        );
        assert_eq!(
            restored_position((Some(2000), Some(246)), &[primary], primary),
            (765, 3)
        );
        assert_eq!(restored_position((Some(500), None), &screens, primary), (500, 3));
        assert_eq!(
            restored_position((Some(500), None), &[above, primary], primary),
            (500, 3)
        );
        assert_eq!(restored_position((None, None), &screens, primary), (765, 3));
    }
}
