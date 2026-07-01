import { api } from "../lib/api";

export interface ImagePreviewProps {
  path: string;
}

export function ImagePreview({ path }: ImagePreviewProps) {
  return (
    <div className="wsp-image-preview">
      <img src={api.fileUrl(path)} alt={path} />
    </div>
  );
}
