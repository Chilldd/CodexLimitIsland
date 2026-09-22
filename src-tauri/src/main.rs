#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--hook")) {
        codexlimit_lib::run_hook_sender();
    } else {
        codexlimit_lib::run();
    }
}
