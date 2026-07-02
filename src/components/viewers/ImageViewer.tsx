import { api } from "../../lib/api";
import { baseName } from "../../lib/fileTypes";

export interface ImageViewerProps {
  path: string;
  fit: boolean;
  zoom: number;
  rotate: number;
}

/** Image on a neutral checkerboard canvas with fit / zoom / rotate. */
export function ImageViewer({ path, fit, zoom, rotate }: ImageViewerProps) {
  const style = fit
    ? { maxWidth: "100%", maxHeight: "100%", transform: `rotate(${rotate}deg)` }
    : { transform: `rotate(${rotate}deg) scale(${zoom})`, transformOrigin: "center" as const };

  return (
    <div className="aur-image">
      <img src={api.fileUrl(path)} alt={baseName(path)} style={style} />
    </div>
  );
}
