import {
  FileText, Globe, Play, Layers, BookOpen, Image, Music, Video, Table2,
} from "lucide-react";

export interface SourceIconConfig {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: string;
}

export const SOURCE_ICONS: Record<string, SourceIconConfig> = {
  pdf:                 { icon: FileText, color: "text-red-500",     bg: "bg-red-50",    label: "PDF" },
  youtube:             { icon: Play,     color: "text-red-600",     bg: "bg-red-50",    label: "YouTube" },
  web_page:            { icon: Globe,    color: "text-blue-500",    bg: "bg-blue-50",   label: "Web page" },
  pasted_text:         { icon: FileText, color: "text-amber-500",   bg: "bg-amber-50",  label: "Text" },
  google_docs:         { icon: FileText, color: "text-blue-600",    bg: "bg-blue-50",   label: "Google Docs" },
  google_slides:       { icon: Layers,   color: "text-yellow-500",  bg: "bg-yellow-50", label: "Google Slides" },
  google_spreadsheet:  { icon: Table2,   color: "text-green-500",   bg: "bg-green-50",  label: "Google Sheets" },
  google_drive_audio:  { icon: Music,    color: "text-purple-500",  bg: "bg-purple-50", label: "Drive Audio" },
  google_drive_video:  { icon: Video,    color: "text-blue-500",    bg: "bg-blue-50",   label: "Drive Video" },
  markdown:            { icon: FileText, color: "text-slate-600",   bg: "bg-slate-50",  label: "Markdown" },
  docx:                { icon: FileText, color: "text-blue-700",    bg: "bg-blue-50",   label: "Word" },
  csv:                 { icon: Table2,   color: "text-emerald-500", bg: "bg-emerald-50",label: "CSV" },
  epub:                { icon: BookOpen, color: "text-indigo-500",  bg: "bg-indigo-50", label: "EPUB" },
  image:               { icon: Image,    color: "text-pink-500",    bg: "bg-pink-50",   label: "Image" },
  media:               { icon: Music,    color: "text-purple-500",  bg: "bg-purple-50", label: "Media" },
  unknown:             { icon: FileText, color: "text-muted-foreground", bg: "bg-muted", label: "Source" },
};

export function getSourceIcon(kind: string): SourceIconConfig {
  return SOURCE_ICONS[kind] ?? SOURCE_ICONS.unknown;
}
