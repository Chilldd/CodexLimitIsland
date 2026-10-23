use super::{collector::ResourceCollector, now_ms, ProcessMetrics, SystemResourceSnapshot, APP_SERVER_PID};
use std::{collections::HashMap, mem::size_of, sync::atomic::Ordering, thread};
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        },
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        SystemInformation::GetSystemTimeAsFileTime,
        Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            PROCESS_VM_READ,
        },
    },
};

pub(crate) struct WindowsResourceCollector {
    prev_times: HashMap<u32, (u64, bool)>,
    prev_sys_time: u64,
    num_cpus: f64,
}

impl WindowsResourceCollector {
    pub(crate) fn new() -> Self {
        let num_cpus = thread::available_parallelism().map(|v| v.get()).unwrap_or(1) as f64;

        Self {
            prev_times: HashMap::new(),
            prev_sys_time: 0,
            num_cpus,
        }
    }
}

impl ResourceCollector for WindowsResourceCollector {
    fn sample(&mut self) -> SystemResourceSnapshot {
        let (raw_samples, curr_sys_time) = collect_raw_samples();

        let mut app_cpu = 0.0f32;
        let mut tasks_cpu = 0.0f32;
        let mut app_mem = 0u64;
        let mut tasks_mem = 0u64;

        // 仅在已有基线时间时计算 CPU delta
        if self.prev_sys_time > 0 {
            let delta_sys = curr_sys_time.saturating_sub(self.prev_sys_time);
            // 采样间隔至少 100ms (1_000_000 in 100ns)
            if delta_sys >= 1_000_000 {
                for sample in &raw_samples {
                    if let Some(&(prev_proc_time, _)) = self.prev_times.get(&sample.pid) {
                        let delta_proc = sample.total_time_100ns.saturating_sub(prev_proc_time);
                        let cpu = (delta_proc as f64 / (delta_sys as f64 * self.num_cpus) * 100.0) as f32;
                        let cpu = cpu.clamp(0.0, 100.0);
                        if sample.is_app {
                            app_cpu += cpu;
                        } else {
                            tasks_cpu += cpu;
                        }
                    }
                }
            }
        }

        let mut next_times: HashMap<u32, (u64, bool)> = HashMap::with_capacity(raw_samples.len());

        for sample in raw_samples {
            if sample.is_app {
                app_mem = app_mem.saturating_add(sample.mem_bytes);
            } else {
                tasks_mem = tasks_mem.saturating_add(sample.mem_bytes);
            }
            next_times.insert(sample.pid, (sample.total_time_100ns, sample.is_app));
        }

        self.prev_times = next_times;
        self.prev_sys_time = curr_sys_time;

        let total_cpu = (app_cpu + tasks_cpu).clamp(0.0, 100.0);
        let total_mem = app_mem.saturating_add(tasks_mem);

        SystemResourceSnapshot {
            total: ProcessMetrics {
                cpu_percent: total_cpu,
                memory_bytes: total_mem,
            },
            app: ProcessMetrics {
                cpu_percent: app_cpu.clamp(0.0, 100.0),
                memory_bytes: app_mem,
            },
            tasks: ProcessMetrics {
                cpu_percent: tasks_cpu.clamp(0.0, 100.0),
                memory_bytes: tasks_mem,
            },
            sample_time_ms: now_ms(),
        }
    }
}

pub(crate) struct RawProcessSample {
    pub(crate) pid: u32,
    pub(crate) is_app: bool,
    pub(crate) total_time_100ns: u64,
    pub(crate) mem_bytes: u64,
}

fn collect_raw_samples() -> (Vec<RawProcessSample>, u64) {
    let mut sys_file_time = 0i64;
    unsafe {
        GetSystemTimeAsFileTime(&mut sys_file_time as *mut _ as *mut _);
    }
    let current_sys_time = sys_file_time as u64;

    let self_pid = std::process::id();
    let app_server_pid = APP_SERVER_PID.load(Ordering::Relaxed);

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return (Vec::new(), current_sys_time);
    }

    let mut samples = Vec::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

    if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
        loop {
            let pid = entry.th32ProcessID;
            if pid != self_pid && (app_server_pid == 0 || pid != app_server_pid) {
                let exe_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let exe_name = String::from_utf16_lossy(&entry.szExeFile[..exe_len]);
                let exe_lower = exe_name.to_lowercase();

                // 候选过滤：包含 codex / chatgpt 或 runtime node 进程
                let is_candidate =
                    exe_lower.contains("codex") || exe_lower.contains("chatgpt") || exe_lower.starts_with("node");

                if is_candidate {
                    if let Some(sample) = inspect_process(pid, &exe_name) {
                        samples.push(sample);
                    }
                }
            }

            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    unsafe {
        CloseHandle(snapshot);
    }

    (samples, current_sys_time)
}

fn inspect_process(pid: u32, exe_name: &str) -> Option<RawProcessSample> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if handle.is_null() {
        return None;
    }

    let mut path_buf = [0u16; 1024];
    let mut size = path_buf.len() as u32;
    let category = if unsafe { QueryFullProcessImageNameW(handle, 0, path_buf.as_mut_ptr(), &mut size) } != 0 {
        let full_path = String::from_utf16_lossy(&path_buf[..size as usize]);
        classify_process(exe_name, &full_path)
    } else {
        classify_by_name(exe_name)
    };

    let is_app = match category {
        Some(ProcessGroup::App) => true,
        Some(ProcessGroup::Task) => false,
        None => {
            unsafe {
                CloseHandle(handle);
            }
            return None;
        }
    };

    let mut pmc: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    pmc.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mem_bytes = if unsafe { GetProcessMemoryInfo(handle, &mut pmc, pmc.cb) } != 0 {
        pmc.WorkingSetSize as u64
    } else {
        0
    };

    let mut creation = 0i64;
    let mut exit = 0i64;
    let mut kernel = 0i64;
    let mut user = 0i64;
    let total_time_100ns = if unsafe {
        GetProcessTimes(
            handle,
            &mut creation as *mut _ as *mut _,
            &mut exit as *mut _ as *mut _,
            &mut kernel as *mut _ as *mut _,
            &mut user as *mut _ as *mut _,
        )
    } != 0
    {
        (kernel.max(0) as u64).saturating_add(user.max(0) as u64)
    } else {
        0
    };

    unsafe {
        CloseHandle(handle);
    }

    Some(RawProcessSample {
        pid,
        is_app,
        total_time_100ns,
        mem_bytes,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProcessGroup {
    App,
    Task,
}

pub(crate) fn classify_process(exe_name: &str, full_path: &str) -> Option<ProcessGroup> {
    let lower_path = full_path.replace('/', "\\").to_lowercase();
    let lower_name = exe_name.to_lowercase();

    // 排除自身的构建与主程序
    if lower_path.contains("codexlimit") {
        return None;
    }

    // 1. 桌面端应用（App 组）
    // Windows Store 安装：路径包含 WindowsApps\OpenAI.Codex 或 OpenAI.Codex_
    // 独立安装版：路径包含 OpenAI\Codex\Codex.exe 或 Programs\Codex\Codex.exe
    if lower_path.contains("windowsapps\\openai.codex")
        || lower_path.contains("openai.codex_")
        || (lower_path.contains("programs\\codex") && !lower_path.contains("\\bin\\"))
        || (lower_path.contains("openai\\codex")
            && (lower_name == "codex.exe" || lower_name == "chatgpt.exe")
            && !lower_path.contains("\\bin\\"))
    {
        return Some(ProcessGroup::App);
    }

    // 2. 任务与 CLI 进程（Task 组）
    // 同时识别桌面端运行时与主运行时缓存，目录边界避免计入名称相近的其他 Node 环境。
    if lower_name == "codex.exe"
        || lower_name.starts_with("codex-")
        || lower_path.contains("openai\\codex\\runtimes\\")
        || lower_path.contains("\\.cache\\codex-runtimes\\")
    {
        return Some(ProcessGroup::Task);
    }

    None
}

fn classify_by_name(exe_name: &str) -> Option<ProcessGroup> {
    let lower = exe_name.to_lowercase();
    if lower == "codex.exe" || lower.starts_with("codex-") {
        Some(ProcessGroup::Task)
    } else {
        None
    }
}
