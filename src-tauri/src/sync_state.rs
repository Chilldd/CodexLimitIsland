use std::sync::{Mutex, MutexGuard};
// 中毒意味着上一次修改未完成；这些缓存/索引可以重建，先清空再恢复服务。
pub(crate) fn lock<T: Default>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(value) => value,
        Err(error) => {
            let mut value = error.into_inner();
            *value = T::default();
            mutex.clear_poison();
            crate::diagnostics::log("共享状态中毒，已重置", None);
            value
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn poisoned_state_is_reset_and_future_writes_work() {
        let state = Mutex::new(vec![1]);
        let _ = std::panic::catch_unwind(|| {
            let mut value = state.lock().unwrap();
            value.push(2);
            panic!("injected")
        });
        assert!(lock(&state).is_empty());
        lock(&state).push(3);
        assert_eq!(*lock(&state), vec![3]);
        assert!(!state.is_poisoned());
    }
}
