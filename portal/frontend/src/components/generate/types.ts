import {
  Music, Video, FileText, Brain, StickyNote,
  Image, Layers, BarChart2, Database,
} from "lucide-react";
import type { GenerateRequest } from "@/lib/api";

export type FieldKind = "select" | "textarea";

export interface FieldDef {
  name: keyof GenerateRequest;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  default?: string;
  required?: boolean;
  placeholder?: string;
}

export interface GenerateTypeDef {
  key: string;
  label: string;
  icon: React.ElementType;
  iconColor: string;
  bg: string;
  fields: FieldDef[];
  /** Override default form-submit description label */
  descriptionLabel?: string;
  descriptionRequired?: boolean;
  descriptionPlaceholder?: string;
}

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "zh-TW", label: "Chinese (Traditional)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
];

const LANGUAGE_FIELD: FieldDef = {
  name: "language", label: "Language", kind: "select",
  options: LANGUAGE_OPTIONS, default: "en",
};

export const TYPE_DEFS: GenerateTypeDef[] = [
  {
    key: "audio",
    label: "Audio Overview",
    icon: Music,
    iconColor: "text-purple-500",
    bg: "bg-purple-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional steering instructions for the host(s)…",
    fields: [
      { name: "audio_format", label: "Format", kind: "select", default: "deep-dive", options: [
        { value: "deep-dive", label: "Deep dive (two-host conversation)" },
        { value: "brief", label: "Brief (concise summary)" },
        { value: "critique", label: "Critique (analytical review)" },
        { value: "debate", label: "Debate (opposing views)" },
      ]},
      { name: "audio_length", label: "Length", kind: "select", default: "default", options: [
        { value: "short", label: "Short" },
        { value: "default", label: "Default" },
        { value: "long", label: "Long" },
      ]},
      LANGUAGE_FIELD,
    ],
  },
  {
    key: "video",
    label: "Video Overview",
    icon: Video,
    iconColor: "text-blue-500",
    bg: "bg-blue-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional steering instructions…",
    fields: [
      { name: "video_format", label: "Format", kind: "select", default: "explainer", options: [
        { value: "explainer", label: "Explainer" },
        { value: "brief", label: "Brief" },
        { value: "cinematic", label: "Cinematic (Veo 3, ~30 min, requires Ultra)" },
      ]},
      { name: "video_style", label: "Style", kind: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "classic", label: "Classic" },
        { value: "whiteboard", label: "Whiteboard" },
        { value: "kawaii", label: "Kawaii" },
        { value: "anime", label: "Anime" },
        { value: "watercolor", label: "Watercolor" },
        { value: "retro-print", label: "Retro print" },
        { value: "heritage", label: "Heritage" },
        { value: "paper-craft", label: "Paper craft" },
      ]},
      LANGUAGE_FIELD,
    ],
  },
  {
    key: "report",
    label: "Report",
    icon: FileText,
    iconColor: "text-amber-500",
    bg: "bg-amber-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Custom prompt OR extra instructions for the chosen format…",
    fields: [
      { name: "report_format", label: "Format", kind: "select", default: "briefing-doc", options: [
        { value: "briefing-doc", label: "Briefing doc" },
        { value: "study-guide", label: "Study guide" },
        { value: "blog-post", label: "Blog post" },
        { value: "custom", label: "Custom (write your own prompt)" },
      ]},
      LANGUAGE_FIELD,
    ],
  },
  {
    key: "slide_deck",
    label: "Slide Deck",
    icon: Layers,
    iconColor: "text-indigo-500",
    bg: "bg-indigo-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional steering instructions…",
    fields: [
      { name: "deck_format", label: "Format", kind: "select", default: "detailed", options: [
        { value: "detailed", label: "Detailed deck" },
        { value: "presenter", label: "Presenter slides" },
      ]},
      { name: "deck_length", label: "Length", kind: "select", default: "default", options: [
        { value: "default", label: "Default" },
        { value: "short", label: "Short" },
      ]},
      LANGUAGE_FIELD,
    ],
  },
  {
    key: "quiz",
    label: "Quiz",
    icon: Brain,
    iconColor: "text-green-500",
    bg: "bg-green-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional focus areas for the questions…",
    fields: [
      { name: "quiz_quantity", label: "Quantity", kind: "select", default: "standard", options: [
        { value: "fewer", label: "Fewer" },
        { value: "standard", label: "Standard" },
        { value: "more", label: "More" },
      ]},
      { name: "quiz_difficulty", label: "Difficulty", kind: "select", default: "medium", options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ]},
    ],
  },
  {
    key: "flashcards",
    label: "Flashcards",
    icon: StickyNote,
    iconColor: "text-teal-500",
    bg: "bg-teal-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional focus areas for the cards…",
    fields: [
      { name: "quiz_quantity", label: "Quantity", kind: "select", default: "standard", options: [
        { value: "fewer", label: "Fewer" },
        { value: "standard", label: "Standard" },
        { value: "more", label: "More" },
      ]},
      { name: "quiz_difficulty", label: "Difficulty", kind: "select", default: "medium", options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ]},
    ],
  },
  {
    key: "infographic",
    label: "Infographic",
    icon: Image,
    iconColor: "text-rose-500",
    bg: "bg-rose-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional steering instructions…",
    fields: [
      { name: "info_orientation", label: "Orientation", kind: "select", default: "landscape", options: [
        { value: "landscape", label: "Landscape" },
        { value: "portrait", label: "Portrait" },
        { value: "square", label: "Square" },
      ]},
      { name: "info_detail", label: "Detail", kind: "select", default: "standard", options: [
        { value: "concise", label: "Concise" },
        { value: "standard", label: "Standard" },
        { value: "detailed", label: "Detailed" },
      ]},
      { name: "info_style", label: "Style", kind: "select", default: "auto", options: [
        { value: "auto", label: "Auto" },
        { value: "sketch-note", label: "Sketch note" },
        { value: "professional", label: "Professional" },
        { value: "bento-grid", label: "Bento grid" },
        { value: "editorial", label: "Editorial" },
        { value: "instructional", label: "Instructional" },
        { value: "bricks", label: "Bricks" },
        { value: "clay", label: "Clay" },
        { value: "anime", label: "Anime" },
        { value: "kawaii", label: "Kawaii" },
        { value: "scientific", label: "Scientific" },
      ]},
      LANGUAGE_FIELD,
    ],
  },
  {
    key: "data_table",
    label: "Data Table",
    icon: BarChart2,
    iconColor: "text-orange-500",
    bg: "bg-orange-50",
    descriptionLabel: "Table structure",
    descriptionRequired: true,
    descriptionPlaceholder: "e.g. \"Compare the leadership traits across each historical figure as columns\"",
    fields: [LANGUAGE_FIELD],
  },
  {
    key: "mind_map",
    label: "Mind Map",
    icon: Database,
    iconColor: "text-cyan-500",
    bg: "bg-cyan-50",
    descriptionLabel: "Description (optional)",
    descriptionPlaceholder: "Optional focus areas…",
    fields: [LANGUAGE_FIELD],
  },
];

export function findTypeDef(key: string): GenerateTypeDef | undefined {
  return TYPE_DEFS.find((t) => t.key === key);
}
