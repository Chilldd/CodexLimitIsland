// Hook 元数据兼容旧 ID；导航和文件检索使用各自已有的更严格边界。
pub(crate) fn is_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
pub(crate) fn is_filename_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_preserves_distinct_boundaries() {
        assert!(is_filename_id("abc-123"));
        assert!(!is_uuid("abc-123"));
        assert!(is_uuid("01234567-89ab-cdef-0123-456789abcdef"));
        for id in ["../abc", "abc/def", "a\\b", "", "a?b"] {
            assert!(!is_filename_id(id));
            assert!(!is_uuid(id));
        }
    }
}
