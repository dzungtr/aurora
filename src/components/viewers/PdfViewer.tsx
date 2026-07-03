import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
// Text/annotation layers are disabled below, so their CSS is not needed.
// If you enable them, also import the matching react-pdf layer stylesheets.
import { api } from "../../lib/api";

// pdf.js worker — served locally by server.ts (see the "/pdf.worker.min.mjs"
// route), so PDF viewing works fully offline.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface PdfViewerProps {
  path: string;
  zoom: number;
  onPageChange: (page: number, count: number) => void;
}

/**
 * PDF viewer: page-thumbnail rail + continuous scroll of full pages, driven by
 * react-pdf (pdf.js). Zoom scales page width; the toolbar shows the current page.
 * For very large documents, virtualise the page list rather than rendering all
 * pages up front.
 */
export function PdfViewer({ path, zoom, onPageChange }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const fileUrl = api.fileUrl(path);
  const baseWidth = Math.round(720 * zoom);

  useEffect(() => { onPageChange(current, numPages); }, [current, numPages, onPageChange]);

  const onScroll = () => {
    const c = scrollRef.current;
    if (!c) return;
    const mid = c.scrollTop + c.clientHeight / 2;
    let idx = 1;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (el && el.offsetTop <= mid) idx = i + 1;
    }
    if (idx !== current) setCurrent(idx);
  };

  const goto = (n: number) => {
    const el = pageRefs.current[n - 1];
    const c = scrollRef.current;
    if (el && c) c.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" });
  };

  return (
    <div className="aur-pdf">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div className="aur-pdf__fallback">Loading…</div>}
        error={<div className="aur-pdf__fallback">Unable to load PDF.</div>}
      >
        <div className="aur-pdf__rail">
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              className={`aur-pdf__thumb${current === i + 1 ? " is-active" : ""}`}
              onClick={() => goto(i + 1)}
            >
              <div className="aur-pdf__thumb-frame">
                <Page pageNumber={i + 1} width={92} renderTextLayer={false} renderAnnotationLayer={false} />
              </div>
              <span className="aur-pdf__thumb-num">{i + 1}</span>
            </div>
          ))}
        </div>

        <div className="aur-pdf__pages" ref={scrollRef} onScroll={onScroll}>
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i} className="aur-pdf__page" ref={(el) => { pageRefs.current[i] = el; }}>
              <Page pageNumber={i + 1} width={baseWidth} renderTextLayer={false} renderAnnotationLayer={false} />
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
}
