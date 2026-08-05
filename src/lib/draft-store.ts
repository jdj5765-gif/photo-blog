/**
 * 생성한 초안을 브라우저에 24시간만 보관합니다.
 *
 * 아카이브가 아니라 새로고침·실수 대비 안전망입니다.
 * 본문 텍스트만 담습니다. 사진은 저장하지 않습니다 — 원본은 사용자 기기에 있고,
 * base64로 넣으면 글 두세 편에서 localStorage 한도(약 5MB)를 넘습니다.
 */

const KEY = "photo-blog:drafts";

/** 저장 시각으로부터 24시간. 항목마다 개별로 만료됩니다. */
export const TTL_MS = 24 * 60 * 60 * 1000;

export interface SavedDraft {
  id: string;
  /** 목록에서 알아보는 이름. 가게 이름이 없으면 "이름 없음". */
  storeName: string;
  /** 최초 저장 시각(ms). 수정해도 연장되지 않습니다. */
  savedAt: number;
  body: string;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): SavedDraft[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is SavedDraft =>
        !!d &&
        typeof d.id === "string" &&
        typeof d.storeName === "string" &&
        typeof d.savedAt === "number" &&
        typeof d.body === "string",
    );
  } catch {
    // 다른 탭이 깨진 값을 넣었거나 JSON이 아닌 경우. 보관함은 안전망이라 조용히 비웁니다.
    return [];
  }
}

function writeAll(drafts: SavedDraft[]) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // 한도를 넘었으면 가장 오래된 것부터 버리고 한 번 더 시도합니다.
    try {
      localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, 20)));
    } catch {
      // 그래도 안 되면 보관을 포기합니다. 화면의 글은 그대로 남습니다.
    }
  }
}

/** 만료된 항목을 걸러내고 최신순으로 돌려줍니다. */
export function loadDrafts(now = Date.now()): SavedDraft[] {
  const all = readAll();
  const alive = all.filter((d) => now - d.savedAt < TTL_MS);
  if (alive.length !== all.length) writeAll(alive);
  return [...alive].sort((a, b) => b.savedAt - a.savedAt);
}

/** 새 초안을 담고 갱신된 목록을 돌려줍니다. */
export function saveDraft(
  storeName: string,
  body: string,
  now = Date.now(),
): { draft: SavedDraft; drafts: SavedDraft[] } {
  const draft: SavedDraft = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    storeName: storeName.trim() || "이름 없음",
    savedAt: now,
    body,
  };
  const next = [draft, ...loadDrafts(now)];
  writeAll(next);
  return { draft, drafts: next };
}

/** 기존 항목의 본문을 덮어씁니다. 새 항목은 생기지 않고 만료 시각도 그대로입니다. */
export function updateDraft(
  id: string,
  body: string,
  now = Date.now(),
): SavedDraft[] {
  const next = loadDrafts(now).map((d) => (d.id === id ? { ...d, body } : d));
  writeAll(next);
  return next;
}

export function deleteDraft(id: string, now = Date.now()): SavedDraft[] {
  const next = loadDrafts(now).filter((d) => d.id !== id);
  writeAll(next);
  return next;
}

/** "8/5 14:32" 형태의 짧은 날짜. */
export function formatSavedAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "3시간 뒤 삭제" 처럼 남은 보관 시간을 알려줍니다. */
export function formatExpiry(savedAt: number, now = Date.now()): string {
  const left = savedAt + TTL_MS - now;
  if (left <= 0) return "곧 삭제";
  const hours = Math.floor(left / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}시간 뒤 삭제`;
  const minutes = Math.max(1, Math.floor(left / (60 * 1000)));
  return `${minutes}분 뒤 삭제`;
}
