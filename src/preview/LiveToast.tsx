// Centered bottom toast for artifact pushes to sessions the user is NOT
// viewing. Aurora never navigates the user away from what they are reading;
// pushes to the current session are handled by StackView's auto-advance
// (gated behind "Follow latest") instead.

import { useEffect, useState } from "react";
import { onArtifactEvent } from "./liveSocket";
import { navigate, previewUrl } from "./previewApi";
import { Icon } from "../components/Icon";

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

  const view = () => {
    const sessionId = toast.session_id;
    setToast(null);
    navigate(previewUrl(sessionId)); // no artifact id → StackView resolves to latest
  };

  return (
    <div className="aur-live-toast" role="status">
      <span className="aur-live-toast__dot" />
      <span className="aur-live-toast__text">
        {toast.count} new artifact{toast.count === 1 ? "" : "s"} in <b>{toast.session_id}</b>
      </span>
      <button className="aur-live-toast__view" onClick={view}>View</button>
      <button className="aur-live-toast__dismiss" aria-label="Dismiss" onClick={() => setToast(null)}>
        <Icon name="uil:times" size={14} />
      </button>
    </div>
  );
}
