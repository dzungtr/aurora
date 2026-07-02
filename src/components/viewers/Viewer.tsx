import type { Buffer, ViewState } from "../../App";
import { kindOf } from "../../lib/fileTypes";
import { TextViewer } from "./TextViewer";
import { MarkdownViewer } from "./MarkdownViewer";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";
import { AudioViewer } from "./AudioViewer";
import { PdfViewer } from "./PdfViewer";

export interface ViewerProps {
  path: string;
  buffer?: Buffer;
  onChange: (v: string) => void;
  view: ViewState;
  onPdfPage: (page: number, count: number) => void;
}

/** Routes the selected file to the viewer for its kind. */
export function Viewer({ path, buffer, onChange, view, onPdfPage }: ViewerProps) {
  switch (kindOf(path)) {
    case "markdown":
      return <MarkdownViewer buffer={buffer} onChange={onChange} mode={view.mdMode} />;
    case "image":
      return <ImageViewer path={path} fit={view.fit} zoom={view.zoom} rotate={view.rotate} />;
    case "video":
      return <VideoViewer path={path} />;
    case "audio":
      return <AudioViewer path={path} />;
    case "pdf":
      return <PdfViewer path={path} zoom={view.pdfZoom} onPageChange={onPdfPage} />;
    default:
      return <TextViewer path={path} buffer={buffer} onChange={onChange} wrap={view.wrap} />;
  }
}
