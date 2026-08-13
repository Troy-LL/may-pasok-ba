import { Board } from "@/components/board";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const placeId = typeof params.place === "string" ? params.place : undefined;
  return <Board initialPlaceId={placeId} />;
}
