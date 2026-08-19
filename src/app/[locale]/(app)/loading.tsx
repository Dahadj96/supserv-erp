import { ListSkeleton } from "@/components/ui/state-block";

/** Screen 34 — the loading state, shared by every route behind the shell. */
export default function Loading() {
  return (
    <main className="min-h-0 flex-1 overflow-auto px-7 py-6">
      <ListSkeleton />
    </main>
  );
}
