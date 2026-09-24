#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--hook")) {
        if let Err(error) = codexlimit_lib::run_hook_sender() {
            eprintln!("Codex Limit Island: {error}");
            std::process::exit(1);
        }
    } else {
        codexlimit_lib::run();
    }
}
