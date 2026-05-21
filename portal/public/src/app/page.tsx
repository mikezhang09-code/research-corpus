import { redirect } from "next/navigation";

// "My Research" is the primary surface of the public app; the NotebookLM
// corpus is a view-only archive reached from the section switch.
export default function Home() {
  redirect("/library");
}
