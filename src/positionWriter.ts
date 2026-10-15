// 原生移动慢于 RAF 时，只保留最新目标；同一窗口始终至多一个请求在途。
export function createPositionWriter(move: (x: number, y: number) => Promise<void>, report: (error: unknown) => void) {
  let active = true;
  let inFlight = false;
  let pending: { x: number; y: number } | null = null;
  let sent: { x: number; y: number } | null = null;
  function pump() {
    if (!active || inFlight || !pending) return;
    const next = pending;
    pending = null;
    if (sent?.x === next.x && sent.y === next.y) return;
    sent = next;
    inFlight = true;
    void move(next.x, next.y)
      .catch((error: unknown) => {
        sent = null;
        if (active) report(error);
      })
      .finally(() => {
        inFlight = false;
        pump();
      });
  }
  return {
    move(x: number, y: number) {
      if (!active) return;
      pending = { x, y };
      pump();
    },
    activate() {
      active = true;
      pump();
    },
    dispose() {
      active = false;
      pending = null;
    },
  };
}
