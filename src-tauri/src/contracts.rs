use crate::{
    activity::model::*,
    settings::LimitDisplayWindow,
    token_usage::TokenUsage,
    usage::{LimitWindow, UsageSnapshot},
};
use ts_rs::{Config, TS};
#[test]
fn frontend_contract_matches_rust() {
    let config = Config::new().with_large_int("number");
    let types = [
        Activity::decl(&config),
        Attention::decl(&config),
        Lifecycle::decl(&config),
        TurnResultKind::decl(&config),
        Agent::decl(&config),
        Session::decl(&config),
        TurnResult::decl(&config),
        ActivitySnapshot::decl(&config),
        LimitWindow::decl(&config),
        UsageSnapshot::decl(&config),
        LimitDisplayWindow::decl(&config),
        TokenUsage::decl(&config),
    ];
    let output = format!(
        "// 由 Rust ts-rs 生成；运行 npm.cmd run contracts:generate，请勿手工编辑。\n{}\n",
        types
            .into_iter()
            .map(|t| format!("export {t}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/generated/contracts.ts");
    if std::env::var_os("CODEXLIMIT_GENERATE_TYPES").as_deref() == Some(std::ffi::OsStr::new("1")) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &output).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path)
            .expect("请运行 npm.cmd run contracts:generate")
            .replace("\r\n", "\n"),
        output,
        "Rust/TypeScript 契约漂移，请运行 npm.cmd run contracts:generate"
    );
    assert!(!output.contains("bigint"));
    assert!(!output.contains("rootActivity"));
    assert!(output.contains("currentTurnId"));
}
