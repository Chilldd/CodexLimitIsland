#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    let launch_arg = std::env::args_os().nth(1);
    match codexlimit_lib::launch_source(launch_arg.as_deref()) {
        codexlimit_lib::LaunchSource::Hook => {
            if let Err(error) = codexlimit_lib::run_hook_sender() {
                eprintln!("Codex Limit Island: {error}");
                std::process::exit(1);
            }
        }
        source => {
            if codexlimit_lib::prepare_gui_launch(source) { codexlimit_lib::run(); }
        }
    }
}
