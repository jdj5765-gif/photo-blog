// 네이버 플레이스 페이지에서 확인된 사실 정보만 가져옵니다.
// 공식 API가 아니라 플레이스 페이지에 들어있는 데이터를 읽는 방식이라,
// 네이버가 페이지 구조를 바꾸면 실패할 수 있습니다. 실패해도 앱은 수동 입력으로 계속 동작합니다.

import { ALL_NAVER_KEYWORDS } from "./naver-keywords";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export interface PlaceMenu {
  name: string;
  price: string | null;
  recommend: boolean;
}

export interface KeywordVote {
  /** 네이버 키워드 리뷰 문구 (ALL_NAVER_KEYWORDS와 같은 표기) */
  name: string;
  /** 이 문구를 고른 방문자 수 */
  count: number;
}

export interface PlaceInfo {
  id: string;
  name: string | null;
  category: string | null;
  roadAddress: string | null;
  address: string | null;
  phone: string | null;
  conveniences: string[];
  businessHours: string | null;
  menus: PlaceMenu[];
  /** 방문자가 실제로 고른 키워드 리뷰, 많이 고른 순 */
  keywordVotes: KeywordVote[];
  visitorReviewCount: number | null;
  placeUrl: string;
}

/** 입력에서 플레이스 ID를 뽑습니다. 숫자만 넣어도 되고, 각종 URL 형태를 지원합니다. */
export function extractPlaceId(input: string): string | null {
  const s = input.trim();
  if (/^\d{6,12}$/.test(s)) return s;

  // 경로형: map.naver.com/p/entry/place/1234567890, m.place.naver.com/restaurant/1234567890/home
  const path = s.match(
    /(?:place|entry|restaurant|cafe|hairshop|hospital|accommodation)\/(\d{6,12})/,
  );
  if (path) return path[1];

  // 쿼리형: naver.me 단축주소는 appLink.naver?pinId=16855489&id=16855489 형태로 풀립니다.
  const query = s.match(/[?&](?:pinId|id|entryId)=(\d{6,12})/);
  if (query) return query[1];

  const bare = s.match(/(\d{6,12})/);
  return bare ? bare[1] : null;
}

/** naver.me 단축 URL은 리다이렉트를 따라가 원래 주소를 얻습니다. */
async function resolveShortLink(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA },
  });
  return res.url || url;
}

/** `window.__APOLLO_STATE__ = {...}` 를 중괄호 짝을 세어 정확히 잘라냅니다. */
function parseApolloState(html: string): Record<string, unknown> | null {
  const marker = "window.__APOLLO_STATE__";
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface StartEndTime {
  start?: string | null;
  end?: string | null;
}
interface WorkingHoursInfo {
  day?: string | null;
  businessHours?: StartEndTime | null;
  breakHours?: StartEndTime[] | null;
  description?: string | null;
  lastOrderTimes?: { type?: string | null; time?: string | null }[] | null;
}

/** 요일별 영업시간을 사람이 읽는 한 줄로 압축합니다. 같은 시간대의 연속 요일은 묶습니다. */
function formatBusinessHours(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const parts: { day: string; text: string }[] = [];
  for (const item of raw as WorkingHoursInfo[]) {
    const day = typeof item?.day === "string" ? item.day : null;
    if (!day) continue;

    const bh = item.businessHours;
    if (!bh?.start || !bh?.end) {
      parts.push({ day, text: item.description?.trim() || "휴무" });
      continue;
    }
    let text = `${bh.start}~${bh.end}`;
    const brk = (item.breakHours ?? []).filter((b) => b?.start && b?.end);
    if (brk.length > 0) {
      text += ` (브레이크 ${brk.map((b) => `${b.start}~${b.end}`).join(", ")})`;
    }
    parts.push({ day, text });
  }
  if (parts.length === 0) return null;

  // 연속된 같은 시간대를 "월~금" 형태로 묶습니다.
  const groups: { days: string[]; text: string }[] = [];
  for (const p of parts) {
    const last = groups[groups.length - 1];
    if (last && last.text === p.text) last.days.push(p.day);
    else groups.push({ days: [p.day], text: p.text });
  }

  return groups
    .map((g) => {
      const label =
        g.days.length >= 3
          ? `${g.days[0]}~${g.days[g.days.length - 1]}`
          : g.days.join("·");
      return `${label} ${g.text}`;
    })
    .join(" / ");
}

/**
 * 영업시간이 들어있는 위치가 일정하지 않습니다.
 * PlaceDetailBase가 아니라 ROOT_QUERY 쪽 `newBusinessHours({"format":"restaurant"})`
 * 안에 있는 경우가 많고, 키 이름에 인자가 붙어 있어 경로로 찾기 어렵습니다.
 * 그래서 상태 전체를 훑어 요일(day)이 들어있는 배열을 찾습니다.
 */
function findBusinessHours(state: unknown): unknown {
  const seen = new Set<object>();

  function walk(node: unknown): unknown {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (
        /businessHours/i.test(key) &&
        Array.isArray(value) &&
        value.length > 0 &&
        typeof (value[0] as Record<string, unknown>)?.day === "string"
      ) {
        return value;
      }
      const nested = walk(value);
      if (nested) return nested;
    }
    return null;
  }

  return walk(state);
}

/**
 * 방문자가 고른 키워드 리뷰와 득표수를 찾습니다.
 * 영업시간과 마찬가지로 위치가 일정하지 않아 상태 전체를 훑습니다.
 * '더보기' 같은 UI 항목이 섞여 들어오므로 공식 키워드 목록에 있는 것만 남깁니다.
 */
function findKeywordVotes(state: unknown): KeywordVote[] {
  const allowed = new Set(ALL_NAVER_KEYWORDS);
  const seen = new Set<object>();

  function walk(node: unknown): KeywordVote[] | null {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/^votedKeyword$/i.test(key) && value && typeof value === "object") {
        const details = (value as Record<string, unknown>).details;
        if (Array.isArray(details)) {
          const votes = details
            .map((d) => {
              const row = d as Record<string, unknown>;
              return {
                name: typeof row.displayName === "string" ? row.displayName : "",
                count: typeof row.count === "number" ? row.count : 0,
              };
            })
            .filter((v) => allowed.has(v.name) && v.count > 0)
            .sort((a, b) => b.count - a.count);
          if (votes.length > 0) return votes;
        }
      }
      const nested = walk(value);
      if (nested) return nested;
    }
    return null;
  }

  return walk(state) ?? [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function fetchPlaceInfo(input: string): Promise<PlaceInfo> {
  let target = input.trim();
  if (/naver\.me\//.test(target)) {
    target = await resolveShortLink(target);
  }

  const id = extractPlaceId(target);
  if (!id) {
    throw new Error("주소에서 플레이스 번호를 찾지 못했습니다. 네이버 지도의 가게 페이지 주소를 넣어주세요.");
  }

  const placeUrl = `https://m.place.naver.com/place/${id}/home`;
  const res = await fetch(placeUrl, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`플레이스 페이지를 불러오지 못했습니다. (${res.status})`);
  }

  const state = parseApolloState(await res.text());
  if (!state) {
    throw new Error("플레이스 정보를 읽지 못했습니다. 네이버 쪽 구조가 바뀐 것 같습니다.");
  }

  const base = (state[`PlaceDetailBase:${id}`] ??
    Object.entries(state).find(([k]) => k.startsWith("PlaceDetailBase:"))?.[1]) as
    | Record<string, unknown>
    | undefined;
  if (!base) {
    throw new Error("해당 번호의 가게를 찾지 못했습니다. 주소를 다시 확인해주세요.");
  }

  const menus: PlaceMenu[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith(`Menu:${id}_`)) continue;
    const m = value as Record<string, unknown>;
    const name = str(m.name);
    if (!name) continue;
    menus.push({
      name,
      price: str(m.price),
      recommend: m.recommend === true,
    });
  }

  const conveniences = Array.isArray(base.conveniences)
    ? (base.conveniences as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const reviews = base.visitorReviewsTotal;

  return {
    id,
    name: str(base.name),
    category: str(base.category),
    roadAddress: str(base.roadAddress),
    address: str(base.address),
    phone: str(base.virtualPhone) ?? str(base.phone),
    conveniences,
    businessHours: formatBusinessHours(findBusinessHours(state)),
    keywordVotes: findKeywordVotes(state),
    menus,
    visitorReviewCount: typeof reviews === "number" ? reviews : null,
    placeUrl,
  };
}

/** 프롬프트의 '확인된 정보' 칸에 그대로 넣을 수 있는 텍스트로 만듭니다. */
export function placeInfoToFacts(info: PlaceInfo): string {
  const lines: string[] = [];
  if (info.name) lines.push(`상호: ${info.name}`);
  if (info.category) lines.push(`업종: ${info.category}`);
  if (info.roadAddress) lines.push(`주소: ${info.roadAddress}`);
  else if (info.address) lines.push(`주소: ${info.address}`);
  if (info.businessHours) lines.push(`영업시간: ${info.businessHours}`);
  if (info.phone) lines.push(`전화: ${info.phone}`);
  if (info.conveniences.length > 0) lines.push(`편의: ${info.conveniences.join(", ")}`);

  if (info.menus.length > 0) {
    const menuText = info.menus
      .slice(0, 15)
      .map((m) => {
        const price = m.price ? `${Number(m.price).toLocaleString("ko-KR")}원` : "가격 미표기";
        return `${m.name} ${price}`;
      })
      .join(" / ");
    lines.push(`메뉴: ${menuText}`);
  }

  return lines.join("\n");
}
