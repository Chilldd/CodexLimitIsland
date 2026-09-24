fn main() {
    if let Err(error) = codexlimit_lib::run_hook_sender() {
        eprintln!("Codex Limit Island: {error}");
        std::process::exit(1);
    }
}
