import type {
  DocumentEditorHandle,
  DocumentEditorProps,
} from "../../plugins/author";
import { MAX_NOTE_BYTES, noteUrl, type Note } from "./model";
import { usePagesUi } from "./ui";

export type NoteEditorHandle = DocumentEditorHandle;
export function NoteEditor({
  notes,
  community,
  ...props
}: Omit<DocumentEditorProps, "maxLength"> & {
  notes: readonly Note[];
  community: string;
}) {
  const Editor = usePagesUi().conversation.DocumentEditor;
  return (
    <Editor
      {...props}
      maxLength={MAX_NOTE_BYTES}
      label="Page body"
      placeholder="Write your page…"
      destinations={notes
        .filter((note) => !note.deleted)
        .map((note) => ({ label: note.title, href: noteUrl(note, community) }))}
    />
  );
}
