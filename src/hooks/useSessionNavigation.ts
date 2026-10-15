import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useSessionNavigation(isExpanded: () => boolean, debug: boolean, collapse: () => void) {
  const pending = useRef(false);
  const mounted = useRef(true);
  const [openingSession, setOpeningSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function open(sessionId: string) {
    if (pending.current || debug || !isExpanded()) return;
    pending.current = true;
    setOpeningSession(sessionId);
    setError(null);
    try {
      await invoke<void>("open_codex_session", { sessionId });
      if (mounted.current) collapse();
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      pending.current = false;
      if (mounted.current) setOpeningSession(null);
    }
  }
  return { openingSession, error, open };
}
