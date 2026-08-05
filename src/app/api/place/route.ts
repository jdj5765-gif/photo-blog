import { fetchPlaceInfo, placeInfoToFacts, placeInfoToIntro } from "@/lib/naver-place";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return Response.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "플레이스 주소를 입력해주세요." }, { status: 400 });
  }

  try {
    const info = await fetchPlaceInfo(url);
    return Response.json({
      info,
      facts: placeInfoToFacts(info),
      intro: placeInfoToIntro(info),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "플레이스 정보를 가져오지 못했습니다.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
