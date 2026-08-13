import { getPlace, resolvePlace } from "@/lib/places";
import { getStatus } from "@/lib/news";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("place") ?? "";
  const place = getPlace(q) ?? resolvePlace(q);
  const result = await getStatus(place);
  const status = result.ok ? 200 : 502;
  return Response.json(result, { status });
}
