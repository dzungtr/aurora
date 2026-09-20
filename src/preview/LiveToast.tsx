// Toast badge for artifact pushes to sessions the user is NOT viewing.
// Aurora never navigates the user away from what they are reading; pushes to
// the current session are handled by StackView's auto-advance instead.

import { useEffect, useState } from "react";
import { onArtifactEvent } from "./liveSocket";

export function LiveToast({ viewingSessionId }: { viewingSessionId?: string }) {
  const [toast, setToast] = useState<{ session_id: string; count: number } | null>(null);

  useEffect(() => {
    const pending = new Map<string, number>();
    const flush = () => {
      if (pending.size === 0) { setToast(null); return; }
      const [session_id, count] = [...pending.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
      setToast({ session_id, count });
    };
    const unsub = onArtifactEvent((evt) => {
      if (evt.session_id === viewingSessionId) return; // handled by the stack view
      pending.set(evt.session_id, (pending.get(evt.session_id) ?? 0) + 1);
      flush();
    });
    const timer = setInterval(() => { pending.clear(); flush(); }, 6000);
    return () => { unsub(); clearInterval(timer); };
  }, [viewingSessionId]);

  if (!toast) return null;
  return (
    <div className="aur-toast" role="status">
      <span className="aur-toast__badge">{toast.count}</span>
      new artifact{toast.count === 1 ? "" : "s"} in <b>{toast.session_id}</b>
    </div>
  );
}
