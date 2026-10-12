// UI artifact renderer (issue #39): renders a stored openui-lang program via
// the OpenUI <Renderer> with the aurora component library (lib/openuiLibrary
// — same definition the server validated against, so no drift). Invalid or
// dropped statements surface as a visible in-page error block — the same
// pattern as mermaid render failures: never a blank pane.

import { useMemo } from "react";
import { Renderer } from "@openuidev/react-lang";
import { auroraUiLibrary, validateUiProgram, formatUiProgramErrors } from "../../lib/openuiLibrary";

export function UiArtifact({ content }: { content: string }) {
  const errors = useMemo(() => validateUiProgram(content), [content]);
  return (
    <div className="aur-ui">
      {errors.length > 0 && (
        <div className="aur-ui__errorblock" role="alert">
          <div className="aur-ui__errorhead">Invalid statements in this dashboard</div>
          {formatUiProgramErrors(errors)
            .split("\n")
            .slice(1)
            .map((line, i) => (
              <div key={i} className="aur-ui__errorline">{line}</div>
            ))}
        </div>
      )}
      <Renderer library={auroraUiLibrary} response={content} isStreaming={false} />
    </div>
  );
}
