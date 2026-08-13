import { revalidateTag } from "next/cache";
import { WARM_PLACE_IDS, getPlace } from "@/lib/places";
import { getStatus } from "@/lib/news";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false }, { status: 401 });
    }
  }

  revalidateTag("news", "max");

  const warmed: string[] = [];
  for (const id of WARM_PLACE_IDS) {
    const place = getPlace(id);
    if (!place) continue;
    await getStatus(place);
    warmed.push(id);
  }

  return Response.json({ ok: true, warmed, at: new Date().toISOString() });
}
