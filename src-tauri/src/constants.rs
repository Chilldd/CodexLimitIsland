use std::net::{Ipv4Addr, SocketAddrV4};
pub const HOOK_ADDRESS: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 17321);
pub const MAX_HOOK_BYTES: u64 = 1024 * 1024;
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
