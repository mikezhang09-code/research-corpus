import { SectionHead } from "@/components/corpus/SectionHead";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed immediately while page.tsx reads the folio list.
export default function Loading() {
  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section II" title="My Research" count={0} />
      <div className="px-5 sm:px-8 lg:px-14 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] rounded-[2px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
