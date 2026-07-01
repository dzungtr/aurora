export interface FileEditorProps {
  path: string;
  content: string;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}

export function FileEditor(_props: FileEditorProps) {
  return <div className="wsp-editor">(editor placeholder)</div>;
}
