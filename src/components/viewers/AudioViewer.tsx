import { useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { baseName, formatTime } from "../../lib/fileTypes";
import { Icon } from "../Icon";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface AudioViewerProps {
  path: string;
}

/**
 * Audio player with a deterministic waveform timeline. Bars fill up to the
 * current playback position; click anywhere on the waveform to seek.
 * (Swap the synthetic waveform for real peaks via the Web Audio API if the
 * backend can supply decoded samples.)
 */
export function AudioViewer({ path }: AudioViewerProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ct, setCt] = useState(0);
  const [dur, setDur] = useState(0);

  const bars = useMemo(
    () => Array.from({ length: 74 }, (_, i) => {
      const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
      const f = x - Math.floor(x);
      const env = Math.sin((i / 73) * Math.PI);
      return 0.14 + (0.30 + f * 0.70) * (0.45 + 0.55 * env);
    }),
    [],
  );

  const frac = dur ? ct / dur : 0;
  const toggle = () => { const el = ref.current; if (el) el.paused ? el.play() : el.pause(); };
  const seek = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * (el.duration || 0);
  };
  const skip = (d: number) => { const el = ref.current; if (el) el.currentTime = clamp(el.currentTime + d, 0, el.duration || 0); };

  return (
    <div className="aur-audio">
      <div className="aur-audio__card">
        <div className="aur-audio__head">
          <div className="aur-audio__art"><Icon name="uil:music" size={38} color="#fff" /></div>
          <div style={{ minWidth: 0 }}>
            <div className="aur-audio__title">{baseName(path)}</div>
            <div className="aur-audio__sub">Audio track</div>
          </div>
        </div>

        <div className="aur-wave" onClick={seek}>
          {bars.map((h, i) => (
            <div
              key={i}
              className={`aur-wave__bar${(i / bars.length) <= frac ? " is-played" : ""}`}
              style={{ height: `${6 + h * 66}px` }}
            />
          ))}
        </div>

        <div className="aur-audio__times"><span>{formatTime(ct)}</span><span>{formatTime(dur)}</span></div>

        <div className="aur-audio__ctrls">
          <button className="aur-audio__skip" onClick={() => skip(-10)}><Icon name="uil:backward" size={22} /></button>
          <button className="aur-audio__play" onClick={toggle}><Icon name={playing ? "uil:pause" : "uil:play"} size={26} /></button>
          <button className="aur-audio__skip" onClick={() => skip(10)}><Icon name="uil:forward" size={22} /></button>
        </div>

        <audio
          ref={ref}
          src={api.fileUrl(path)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCt(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
        />
      </div>
    </div>
  );
}
