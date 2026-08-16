"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Board } from "@/components/board";

function HomeContent() {
  const placeId = useSearchParams().get("place") ?? undefined;
  return <Board initialPlaceId={placeId} />;
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
