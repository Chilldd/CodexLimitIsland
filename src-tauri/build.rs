fn main() {
    // Tauri 构建脚本默认未追踪图标变化，需让 Cargo 重新嵌入 Windows 程序图标。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
