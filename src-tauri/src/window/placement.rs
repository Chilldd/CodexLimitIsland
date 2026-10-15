pub(crate) fn place_initial(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let screen = monitor.size();
        let origin = monitor.position();
        let width = (390.0 * monitor.scale_factor()) as i32;
        let top = (3.0 * monitor.scale_factor()) as i32;
        window.set_position(tauri::PhysicalPosition::new(
            origin.x + (screen.width as i32 - width) / 2,
            origin.y + top,
        ))?;
    }

    Ok(())
}
