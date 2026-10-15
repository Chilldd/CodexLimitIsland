use serde::Serialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub five_hour: Option<LimitWindow>,
    pub weekly: Option<LimitWindow>,
    pub updated_at: u64,
}

fn parse_window(value: &Value) -> Option<(u64, LimitWindow)> {
    let duration = value.get("windowDurationMins")?.as_u64()?;
    let used = value.get("usedPercent")?.as_f64()?;
    let remaining_percent = (100.0 - used).clamp(0.0, 100.0);
    let resets_at = value.get("resetsAt").and_then(Value::as_i64);
    Some((
        duration,
        LimitWindow {
            remaining_percent,
            resets_at,
        },
    ))
}

pub(crate) fn parse_limits(response: &Value) -> Result<UsageSnapshot, String> {
    let result = response.get("result").ok_or("Codex 响应缺少结果")?;
    let bucket = result
        .pointer("/rateLimitsByLimitId/codex")
        .or_else(|| result.get("rateLimits"))
        .ok_or("Codex 未返回通用限额")?;
    let mut snapshot = UsageSnapshot {
        five_hour: None,
        weekly: None,
        updated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    for field in ["primary", "secondary"] {
        if let Some((minutes, window)) = bucket.get(field).and_then(parse_window) {
            match minutes {
                300 => snapshot.five_hour = Some(window),
                10080 => snapshot.weekly = Some(window),
                _ => (),
            }
        }
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn identifies_windows_by_duration() {
        let response = json!({"result": {"rateLimitsByLimitId": {"codex": {
            "primary": {"usedPercent": 20, "windowDurationMins": 10080, "resetsAt": 1790000000},
            "secondary": {"usedPercent": 35, "windowDurationMins": 300, "resetsAt": 1789900000}
        }}}});
        let snapshot = parse_limits(&response).unwrap();
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 65.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 80.0);
    }
}
