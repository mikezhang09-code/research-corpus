// Shared file-category metadata for the library/folio surface.
// Used by AddFileModal (auto-detection + dropdown options) and FileCard's
// edit dialog (category dropdown). Keep extensions in sync with the
// backend `_CATEGORY_MAP` in portal/backend/routers/library_notebooks.py.

export const CATEGORY_OPTIONS = [
  { value: "note",        label: "Note"        },
  { value: "report",      label: "Report"      },
  { value: "slide",       label: "Slide"       },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "audio",       label: "Audio"       },
  { value: "video",       label: "Video"       },
  { value: "mindmap",     label: "Mind Map"    },
  { value: "image",       label: "Image"       },
  { value: "other",       label: "Other"       },
] as const;

const CATEGORY_MAP: Record<string, string> = {
  ".ppt": "slide", ".pptx": "slide", ".key": "slide", ".odp": "slide",
  ".txt": "note", ".md": "note",
  ".docx": "report", ".doc": "report", ".pdf": "report",
  ".xlsx": "spreadsheet", ".xls": "spreadsheet", ".xlsm": "spreadsheet",
  ".csv": "spreadsheet", ".ods": "spreadsheet",
  ".mp3": "audio", ".m4a": "audio", ".wav": "audio", ".ogg": "audio", ".aac": "audio",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
  ".json": "mindmap",
  ".png": "image", ".jpg": "image", ".jpeg": "image",
  ".gif": "image", ".webp": "image", ".svg": "image",
};

export function detectCategory(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return "other";
  const ext = filename.slice(idx).toLowerCase();
  return CATEGORY_MAP[ext] ?? "other";
}

/** Strip the final `.ext` from a filename. Leaves dotfiles alone. */
export function stripExt(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx <= 0 ? filename : filename.slice(0, idx);
}

export function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
