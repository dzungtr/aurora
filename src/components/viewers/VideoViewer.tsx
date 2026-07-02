import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { formatTime } from "../../lib/fileTypes";
import { Icon } from "../Icon";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const RATES = [1, 1.25, 1.5, 2, 0.5];

export interface VideoViewerProps {
  path: string;
}

/** Custom video player: scrubber, volume, playback speed, fullscreen. */
export function VideoViewer({ path }: VideoViewerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ct, setCt] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  const toggle = () => { const el = ref.current; if (el) el.paused ? el.play() : el.pause(); };
  const seek = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * (el.duration || 0);
  };
  const setVolume = (e: React.MouseEvent) => {
    const el = ref.current;
    const r = e.currentTarget.getBoundingClientRect();
    const v = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (el) { el.volume = v; el.muted = false; }
    setVol(v); setMuted(false);
  };
  const toggleMute = () => { const el = ref.current; if (el) el.muted = !el.muted; setMuted((m) => !m); };
  const cycleRate = () => {
    const nr = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    if (ref.current) ref.current.playbackRate = nr;
    setRate(nr);
  };

  const frac = dur ? ct / dur : 0;
  const volFrac = muted ? 0 : vol;
  const volIcon = muted || vol === 0 ? "uil:volume-mute" : vol < 0.5 ? "uil:volume-down" : "uil:volume";

  return (
    <div className="aur-video">
      <div className="aur-video__stage">
        <video
          ref={ref}
          src={api.fileUrl(path)}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCt(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
          onEnded={() => setPlaying(false)}
        />
      </div>
      <div className="aur-media-bar">
        <button className="aur-play" onClick={toggle}>
          <Icon name={playing ? "uil:pause" : "uil:play"} size={20} />
        </button>
        <span className="aur-time">{formatTime(ct)}</span>
        <div className="aur-track" style={{ flex: 1 }} onClick={seek}>
          <div className="aur-track__rail"><div className="aur-track__fill" style={{ width: `${frac * 100}%` }} /></div>
        </div>
        <span className="aur-time aur-time--dim">{formatTime(dur)}</span>
        <button className="aur-icontog" onClick={toggleMute}><Icon name={volIcon} size={19} /></button>
        <div className="aur-track" style={{ width: 74 }} onClick={setVolume}>
          <div className="aur-track__rail"><div className="aur-track__fill aur-track__fill--vol" style={{ width: `${volFrac * 100}%` }} /></div>
        </div>
        <button className="aur-pill" style={{ minWidth: 44 }} onClick={cycleRate}>{rate}×</button>
        <button className="aur-icontog" onClick={() => ref.current?.requestFullscreen?.()}>
          <Icon name="uil:expand-arrows-alt" size={18} />
        </button>
      </div>
    </div>
  );
}
