"use client";

import { useCallback, useRef, useState } from "react";
import { NAVER_KEYWORD_GROUPS, HIGHLIGHT_PRESETS } from "@/lib/naver-keywords";
import type { PostType } from "@/lib/prompt";
import type { PlaceInfo } from "@/lib/naver-place";

const MAX_IMAGES = 30;

/**
 * 배포 환경(Vercel)은 요청 하나를 4.5MB까지만 받습니다.
 * 다른 입력값과 통신 여유분을 빼고 사진에 3.4MB만 씁니다.
 */
const UPLOAD_BUDGET = 3_400_000;
/** 화질을 낮춰가며 시도할 순서. 위에서부터 쓰고, 안 맞으면 아래로 내려갑니다. */
const STEPS: { edge: number; quality: number }[] = [
  { edge: 1568, quality: 0.85 },
  { edge: 1568, quality: 0.7 },
  { edge: 1280, quality: 0.7 },
  { edge: 1120, quality: 0.6 },
  { edge: 896, quality: 0.55 },
  { edge: 768, quality: 0.5 },
];

interface Photo {
  id: string;
  name: string;
  /** 목록에 보여줄 작은 미리보기 */
  preview: string;
  /** 보낼 때 다시 압축하려고 원본을 들고 있습니다. */
  file: File;
}

/** 캔버스로 리사이즈해서 base64로 만듭니다. */
async function encode(
  file: File,
  edge: number,
  quality: number,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 사용할 수 없습니다.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

async function fileToPhoto(file: File): Promise<Photo> {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    // 미리보기는 작게 만들어 화면을 가볍게 유지합니다.
    preview: `data:image/jpeg;base64,${await encode(file, 320, 0.7)}`,
    file,
  };
}

/**
 * 장수에 맞춰 사진 한 장당 쓸 수 있는 용량을 나누고,
 * 그 안에 들어올 때까지 화질을 단계적으로 낮춥니다.
 */
async function buildImages(
  photos: Photo[],
  onProgress?: (done: number) => void,
): Promise<{ media_type: string; data: string }[]> {
  const perPhoto = UPLOAD_BUDGET / Math.max(photos.length, 1);
  const out: { media_type: string; data: string }[] = [];

  for (const [i, photo] of photos.entries()) {
    let data = "";
    let fits = false;
    for (const step of STEPS) {
      data = await encode(photo.file, step.edge, step.quality);
      if (data.length <= perPhoto) {
        fits = true;
        break;
      }
    }
    // 표의 최저 단계로도 안 맞으면 640px 밑으로는 안 내려가되 계속 줄여봅니다.
    let edge = 768;
    while (!fits && edge > 512) {
      edge = Math.round(edge * 0.8);
      data = await encode(photo.file, edge, 0.45);
      fits = data.length <= perPhoto;
    }
    out.push({ media_type: "image/jpeg", data });
    onProgress?.(i + 1);
  }

  const total = out.reduce((sum, img) => sum + img.data.length, 0);
  if (total > UPLOAD_BUDGET) {
    throw new Error(
      `사진 용량이 커서 다 보낼 수 없습니다. 지금 ${photos.length}장인데 몇 장 줄여주세요.`,
    );
  }
  return out;
}

/** **굵게** 표기를 실제 굵은 글씨로 바꿔 보여줍니다. */
function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

/** 결과를 소제목·문단으로 나눠 보여줍니다. 전체 마크다운을 다루지는 않습니다. */
function ResultView({ md }: { md: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
      {md.split("\n").map((line, i) => {
        const key = `l${i}`;
        if (line.startsWith("### ")) {
          return (
            <h4 key={key} className="mt-4 mb-1 font-semibold">
              {renderInline(line.slice(4), key)}
            </h4>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3
              key={key}
              className="mt-5 mb-2 border-b border-neutral-200 pb-1 font-semibold dark:border-neutral-800"
            >
              {line.slice(3)}
            </h3>
          );
        }
        if (line.trim() === "") return <div key={key} className="h-3" />;
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInline(line, key)}
          </p>
        );
      })}
    </div>
  );
}

/** 붙여넣을 때 굵은 글씨가 살아있도록 HTML로도 함께 복사합니다. */
function toHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return md
    .split("\n")
    .map((line) => {
      const bold = (s: string) =>
        escape(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      if (line.startsWith("### ")) return `<h4>${bold(line.slice(4))}</h4>`;
      if (line.startsWith("## ")) return `<h3>${escape(line.slice(3))}</h3>`;
      if (line.trim() === "") return "<br>";
      return `<p>${bold(line)}</p>`;
    })
    .join("");
}

/** 스트리밍 중인 결과에서 "## 제목 후보" 항목만 뽑아냅니다. */
function parseTitles(md: string): string[] {
  const section = md.split(/^##\s+제목 후보\s*$/m)[1];
  if (!section) return [];
  return section
    .split(/^##\s+/m)[0]
    .split("\n")
    .map((l) => l.match(/^\s*\d+[.)]\s*(.+?)\s*$/)?.[1])
    .filter((t): t is string => Boolean(t));
}

/** "## 사용한 키워드" 줄을 뽑아냅니다. */
function parseUsedKeywords(md: string): string[] {
  const section = md.split(/^##\s+사용한 키워드\s*$/m)[1];
  if (!section) return [];
  return section
    .split(/^##\s+/m)[0]
    .split(/[,\n]/)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function Chip({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** 방문자 득표수처럼 옆에 붙는 작은 숫자 */
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : badge
            ? "border-neutral-500 bg-white text-neutral-900 hover:border-neutral-900 dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100"
            : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-500"
      }`}
    >
      {label}
      {badge ? (
        <span
          className={`ml-1.5 text-xs ${active ? "opacity-70" : "text-neutral-500"}`}
        >
          {badge.toLocaleString("ko-KR")}
        </span>
      ) : null}
    </button>
  );
}

/** 편의시설 목록에서 특정 항목이 있는지 봅니다. (예: "주차" → "주차하기 편해요"가 아니라 편의시설 쪽) */
function has(list: string[], keyword: string): boolean {
  return list.some((c) => c.includes(keyword));
}

/** 네이버가 안 갖고 있어서 직접 눌러야 하는 항목 */
export interface ManualInfo {
  restroom: "실내" | "실외" | null;
  remoteWaiting: "가능" | "불가" | null;
}

function Toggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <span className="flex gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          // 같은 걸 다시 누르면 선택 해제됩니다.
          onClick={() => onChange(value === o ? null : o)}
          className={`rounded border px-2 py-0.5 text-xs transition ${
            value === o
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
              : "border-neutral-300 text-neutral-500 hover:border-neutral-500 dark:border-neutral-700"
          }`}
        >
          {o}
        </button>
      ))}
    </span>
  );
}

/** 플레이스에서 가져온 값만 보여줍니다. 없는 항목은 '미등록'으로 두고 지어내지 않습니다. */
function PlaceInfoCard({
  info,
  manual,
  onManualChange,
}: {
  info: PlaceInfo;
  manual: ManualInfo;
  onManualChange: (next: ManualInfo) => void;
}) {
  const priced = info.menus.filter((m) => m.price);
  const rows: { icon: string; label: string; value: string | null }[] = [
    { icon: "📍", label: "주소", value: info.roadAddress ?? info.address },
    { icon: "🕒", label: "영업", value: info.businessHours },
    {
      icon: "🅿️",
      label: "주차",
      value: has(info.conveniences, "주차") ? "가능" : null,
    },
    { icon: "☎️", label: "전화", value: info.phone },
    {
      icon: "🥡",
      label: "포장·배달",
      value:
        [
          has(info.conveniences, "포장") ? "포장" : null,
          has(info.conveniences, "배달") ? "배달" : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    },
    {
      icon: "👥",
      label: "단체",
      value: has(info.conveniences, "단체") ? "가능" : null,
    },
    {
      icon: "🚻",
      label: "화장실",
      value: info.conveniences.filter((c) => c.includes("화장실")).join(" · ") || null,
    },
    {
      icon: "⏳",
      label: "웨이팅·예약",
      value:
        [
          has(info.conveniences, "대기공간") ? "대기공간 있음" : null,
          has(info.conveniences, "예약") ? "예약 가능" : null,
          info.activeTools.find((t) => t.includes("예약")) ?? null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    },
    {
      icon: "💰",
      label: "대표 가격",
      value:
        priced.length > 0
          ? priced
              .slice(0, 3)
              .map(
                (m) => `${m.name} ${Number(m.price).toLocaleString("ko-KR")}원`,
              )
              .join(" · ")
          : null,
    },
  ];

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/50">
      <p className="mb-3 font-medium">
        {info.name ?? "가게 정보"}
        {info.category && (
          <span className="ml-2 text-xs font-normal text-neutral-500">
            {info.category}
          </span>
        )}
        {info.visitorReviewCount !== null && (
          <span className="ml-2 text-xs font-normal text-neutral-500">
            리뷰 {info.visitorReviewCount.toLocaleString("ko-KR")}
          </span>
        )}
      </p>
      <dl className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-neutral-500">
              {r.icon} {r.label}
            </dt>
            <dd className={r.value ? "" : "text-neutral-400"}>
              {r.value ?? "미등록"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 grid gap-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <p className="text-xs text-neutral-500">
          아래 둘은 네이버가 갖고 있지 않아 직접 눌러주셔야 합니다. 누른 값만 글에 반영됩니다.
        </p>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-neutral-500">🚻 화장실 위치</span>
          <Toggle
            options={["실내", "실외"]}
            value={manual.restroom}
            onChange={(v) =>
              onManualChange({ ...manual, restroom: v as ManualInfo["restroom"] })
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-neutral-500">📱 원격 웨이팅</span>
          <Toggle
            options={["가능", "불가"]}
            value={manual.remoteWaiting}
            onChange={(v) =>
              onManualChange({
                ...manual,
                remoteWaiting: v as ManualInfo["remoteWaiting"],
              })
            }
          />
        </div>
      </div>

      {info.conveniences.length > 0 && (
        <p className="mt-3 border-t border-neutral-200 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
          {info.conveniences.join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [postType, setPostType] = useState<PostType>("restaurant");
  const [subject, setSubject] = useState("");
  const [location, setLocation] = useState("부산");
  const [highlights, setHighlights] = useState<string[]>([]);
  const [customHighlight, setCustomHighlight] = useState("");
  const [naverKeywords, setNaverKeywords] = useState<string[]>([]);
  const [facts, setFacts] = useState("");
  const [extra, setExtra] = useState("");

  const [keywordVotes, setKeywordVotes] = useState<
    { name: string; count: number }[]
  >([]);
  const [placeInfo, setPlaceInfo] = useState<PlaceInfo | null>(null);
  const [manual, setManual] = useState<ManualInfo>({
    restroom: null,
    remoteWaiting: null,
  });
  // 서버에서 받은 원본 정보. 토글을 바꿀 때마다 여기에 덧붙여 다시 씁니다.
  const [baseFacts, setBaseFacts] = useState("");

  const [placeUrl, setPlaceUrl] = useState("");
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeMsg, setPlaceMsg] = useState("");
  const [placeError, setPlaceError] = useState("");
  // 다시 불러왔을 때 이전에 자동으로 채운 부분만 교체하고, 직접 쓴 내용은 남깁니다.
  const autoFactsRef = useRef("");

  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    setError("");
    setNotice("");
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    try {
      const incoming = await Promise.all(list.map(fileToPhoto));
      setPhotos((prev) => {
        const merged = [...prev, ...incoming];
        const over = merged.length - MAX_IMAGES;
        if (over > 0) {
          setNotice(`최대 ${MAX_IMAGES}장까지만 사용합니다. 초과분 ${over}장 제외.`);
        }
        return merged.slice(0, MAX_IMAGES);
      });
    } catch {
      setError("이미지를 읽지 못했습니다. 다른 파일로 시도해주세요.");
    }
  }, []);

  /**
   * 자동으로 채운 부분만 통째로 갈아끼웁니다.
   * 직접 쓰신 내용은 아래에 그대로 남습니다.
   */
  const applyAutoFacts = useCallback((block: string) => {
    setFacts((prev) => {
      const kept = autoFactsRef.current
        ? prev.replace(autoFactsRef.current, "").trim()
        : prev.trim();
      autoFactsRef.current = block;
      return kept ? `${block}\n${kept}` : block;
    });
  }, []);

  const buildAutoFacts = (base: string, m: ManualInfo) =>
    [
      base,
      m.restroom ? `화장실: ${m.restroom}` : null,
      m.remoteWaiting ? `원격 웨이팅: ${m.remoteWaiting}` : null,
    ]
      .filter(Boolean)
      .join("\n");

  const changeManual = useCallback(
    (next: ManualInfo) => {
      setManual(next);
      applyAutoFacts(buildAutoFacts(baseFacts, next));
    },
    [applyAutoFacts, baseFacts],
  );

  const loadPlace = useCallback(async () => {
    const url = placeUrl.trim();
    if (!url) return;
    setPlaceLoading(true);
    setPlaceError("");
    setPlaceMsg("");
    try {
      const res = await fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "정보를 가져오지 못했습니다.");

      const info = data.info as PlaceInfo;
      const nextFacts: string = data.facts ?? "";

      if (info.name) setSubject(info.name);
      if (info.roadAddress) {
        setLocation(info.roadAddress.split(/\s+/).slice(0, 2).join(" "));
      }
      setBaseFacts(nextFacts);
      applyAutoFacts(buildAutoFacts(nextFacts, manual));

      setKeywordVotes(info.keywordVotes ?? []);
      setPlaceInfo(info);

      const missing: string[] = [];
      if (!info.businessHours) missing.push("영업시간");
      if (info.menus.length === 0) missing.push("메뉴·가격");
      setPlaceMsg(
        missing.length > 0
          ? `불러왔습니다. ${missing.join(", ")}은(는) 등록돼 있지 않아 빈칸(____)으로 남습니다.`
          : "불러왔습니다. 아래 '확인된 정보'에서 바로 고칠 수 있습니다.",
      );
    } catch (err) {
      setPlaceError(
        err instanceof Error ? err.message : "정보를 가져오지 못했습니다.",
      );
    } finally {
      setPlaceLoading(false);
    }
  }, [placeUrl, applyAutoFacts, manual]);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const addCustomHighlight = () => {
    const v = customHighlight.trim();
    if (!v) return;
    if (!highlights.includes(v)) setHighlights([...highlights, v]);
    setCustomHighlight("");
  };

  const generate = async () => {
    if (photos.length === 0) {
      setError("사진을 최소 1장 올려주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResult("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setNotice(`사진 준비 중… (0/${photos.length})`);
      const images = await buildImages(photos, (done) =>
        setNotice(`사진 준비 중… (${done}/${photos.length})`),
      );
      setNotice("");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          postType,
          subject,
          location,
          highlights,
          naverKeywords,
          keywordVotes,
          facts,
          extra,
          images,
        }),
      });

      if (!res.ok) {
        // 413은 서버가 JSON이 아니라 안내 문구를 돌려줍니다.
        if (res.status === 413) {
          setError(
            "사진 용량이 한도를 넘었습니다. 장수를 줄이고 다시 시도해주세요.",
          );
          return;
        }
        const { error: msg } = await res
          .json()
          .catch(() => ({ error: `요청 실패 (${res.status})` }));
        setError(msg ?? `요청 실패 (${res.status})`);
        return;
      }
      if (!res.body) {
        setError("응답을 받지 못했습니다.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setResult((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    } finally {
      setLoading(false);
      setNotice("");
      abortRef.current = null;
    }
  };

  const copy = async () => {
    try {
      // 서식이 살아있는 HTML과 원문을 함께 넣습니다.
      // 네이버 에디터처럼 서식을 받는 곳에서는 굵은 글씨가 그대로 붙습니다.
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([toHtml(result)], { type: "text/html" }),
          "text/plain": new Blob([result], { type: "text/plain" }),
        }),
      ]);
    } catch {
      // 오래된 브라우저는 원문만 복사합니다.
      await navigator.clipboard.writeText(result);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyTitle = async (t: string, i: number) => {
    await navigator.clipboard.writeText(t);
    setCopiedTitle(i);
    setTimeout(() => setCopiedTitle(null), 1500);
  };

  const download = () => {
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${subject || "blog-draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const titles = parseTitles(result);
  const usedKeywords = parseUsedKeywords(result);
  const voteMap = new Map(keywordVotes.map((v) => [v.name, v.count]));
  const topVotes = keywordVotes.slice(0, 8);

  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-400";
  const labelCls = "mb-2 block text-sm font-medium";

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사진 → 블로그 초안</h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            사진을 올리고 강조할 포인트만 고르면 SEO 최적화 리뷰 초안이 나옵니다.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/login", { method: "DELETE" });
            window.location.href = "/login";
          }}
          className="shrink-0 text-xs text-neutral-500 underline"
        >
          로그아웃
        </button>
      </header>

      {/* 사진 업로드 */}
      <section className="mb-8">
        <label className={labelCls}>
          사진{" "}
          <span className="font-normal text-neutral-500">
            — 최대 {MAX_IMAGES}장, 올린 순서는 글 흐름에 맞게 재배치됩니다
          </span>
        </label>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-sm transition ${
            dragging
              ? "border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-800"
              : "border-neutral-300 text-neutral-500 dark:border-neutral-700"
          }`}
        >
          사진을 여기에 끌어다 놓거나 클릭해서 선택하세요
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}

        {photos.length > 0 && (
          <>
            <p className="mt-3 text-xs text-neutral-500">
              {photos.length}장 사용 · 예상 비용 약 $
              {(0.05 + photos.length * 0.008 + 0.1).toFixed(2)}
              {photos.length > 15 &&
                " · 장수가 많으면 화질을 낮춰 보냅니다. 8~15장이 가장 좋습니다"}
            </p>
            <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {photos.map((p, i) => (
                <li key={p.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt={p.name}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}
                    className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setPhotos([]);
                setNotice("");
              }}
              className="mt-3 text-xs text-neutral-500 underline"
            >
              전체 지우기
            </button>
          </>
        )}
      </section>

      {/* 기본 정보 */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>리뷰 유형</label>
          <div className="flex gap-2">
            <Chip
              label="맛집"
              active={postType === "restaurant"}
              onClick={() => setPostType("restaurant")}
            />
            <Chip
              label="제품"
              active={postType === "product"}
              onClick={() => setPostType("product")}
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>
            네이버 플레이스 주소{" "}
            <span className="font-normal text-neutral-500">
              — 붙여넣고 불러오면 상호·주소·메뉴·가격이 자동으로 채워집니다 (선택)
            </span>
          </label>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={placeUrl}
              onChange={(e) => setPlaceUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  loadPlace();
                }
              }}
              placeholder="예: https://naver.me/xxxxxxxx"
            />
            <button
              type="button"
              onClick={loadPlace}
              disabled={placeLoading || !placeUrl.trim()}
              className="shrink-0 rounded-md border border-neutral-300 px-4 text-sm font-medium hover:border-neutral-500 disabled:opacity-40 dark:border-neutral-700 dark:hover:border-neutral-500"
            >
              {placeLoading ? "불러오는 중" : "불러오기"}
            </button>
          </div>
          {placeMsg && (
            <p className="mt-1.5 text-xs text-neutral-500">{placeMsg}</p>
          )}
          {placeError && (
            <p className="mt-1.5 text-xs text-red-600">
              {placeError} 직접 입력해도 됩니다.
            </p>
          )}
          {placeInfo && (
            <PlaceInfoCard
              info={placeInfo}
              manual={manual}
              onManualChange={changeManual}
            />
          )}
        </div>
        <div>
          <label className={labelCls}>상호 / 제품명</label>
          <input
            className={inputCls}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="예: 해운대 밀면집"
          />
        </div>
        <div>
          <label className={labelCls}>지역</label>
          <input
            className={inputCls}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="예: 부산 서면 / 해운대"
          />
        </div>
      </section>

      {/* 핵심 포인트 */}
      <section className="mb-8">
        <label className={labelCls}>
          상단 핵심 포인트{" "}
          <span className="font-normal text-neutral-500">
            — 글 맨 위에 불릿으로 올라갑니다
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          {HIGHLIGHT_PRESETS.map((h) => (
            <Chip
              key={h}
              label={h}
              active={highlights.includes(h)}
              onClick={() => toggle(highlights, setHighlights, h)}
            />
          ))}
          {highlights
            .filter((h) => !HIGHLIGHT_PRESETS.includes(h))
            .map((h) => (
              <Chip
                key={h}
                label={h}
                active
                onClick={() => toggle(highlights, setHighlights, h)}
              />
            ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className={inputCls}
            value={customHighlight}
            onChange={(e) => setCustomHighlight(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomHighlight();
              }
            }}
            placeholder="직접 추가 (예: 부산 야장 맛집)"
          />
          <button
            type="button"
            onClick={addCustomHighlight}
            className="shrink-0 rounded-lg border border-neutral-300 px-4 text-sm dark:border-neutral-700"
          >
            추가
          </button>
        </div>
      </section>

      {/* 네이버 키워드 리뷰 */}
      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label className={`${labelCls} mb-0`}>네이버 플레이스 키워드 리뷰</label>
          {naverKeywords.length > 0 && (
            <button
              type="button"
              onClick={() => setNaverKeywords([])}
              className="text-xs text-neutral-500 underline"
            >
              선택 해제 ({naverKeywords.length})
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          {naverKeywords.length === 0
            ? "아무것도 고르지 않으면 AI가 사진을 보고 어울리는 키워드를 직접 골라 제목·본문에 넣습니다."
            : "선택한 키워드는 반드시 반영되고, AI가 사진 근거로 몇 개를 더 추가합니다."}
        </p>

        {topVotes.length > 0 && (
          <div className="mb-5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
            <p className="mb-2 text-xs font-medium">
              방문자가 많이 고른 키워드{" "}
              <span className="font-normal text-neutral-500">
                — 실제 집계값입니다. 고르지 않아도 본문에 자연스럽게 반영됩니다
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {topVotes.map((v) => (
                <Chip
                  key={v.name}
                  label={v.name}
                  badge={v.count}
                  active={naverKeywords.includes(v.name)}
                  onClick={() => toggle(naverKeywords, setNaverKeywords, v.name)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {NAVER_KEYWORD_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-2 text-xs font-medium text-neutral-500">{g.label}</p>
              <div className="flex flex-wrap gap-2">
                {g.items.map((k) => (
                  <Chip
                    key={k}
                    label={k}
                    badge={voteMap.get(k)}
                    active={naverKeywords.includes(k)}
                    onClick={() => toggle(naverKeywords, setNaverKeywords, k)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 추가 정보 */}
      <section className="mb-8 grid gap-4">
        <div>
          <label className={labelCls}>
            확인된 정보{" "}
            <span className="font-normal text-neutral-500">
              — 가격, 영업시간, 방문일 등. 여기 적은 것만 사실로 쓰고, 나머지는
              빈칸(____)으로 남깁니다
            </span>
          </label>
          <textarea
            className={`${inputCls} min-h-24`}
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            placeholder="예: 밀면 9,000원 / 주차 가능 / 2026-08-01 방문"
          />
        </div>
        <div>
          <label className={labelCls}>추가 요청</label>
          <textarea
            className={`${inputCls} min-h-20`}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="예: 웨이팅 팁을 좀 더 자세히 써줘"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {loading ? "작성 중…" : "초안 생성"}
        </button>
        {loading && (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm dark:border-neutral-700"
          >
            중지
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {/* 추천 제목 */}
      {titles.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">추천 제목</h2>
          <ul className="space-y-2">
            {titles.map((t, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="shrink-0 text-xs text-neutral-400">{i + 1}</span>
                <span className="flex-1 text-sm">{t}</span>
                <span
                  className={`shrink-0 text-xs ${
                    t.length >= 30 && t.length <= 40
                      ? "text-neutral-400"
                      : "text-amber-600"
                  }`}
                  title="권장 30~40자"
                >
                  {t.length}자
                </span>
                <button
                  type="button"
                  onClick={() => copyTitle(t, i)}
                  className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                >
                  {copiedTitle === i ? "복사됨" : "복사"}
                </button>
              </li>
            ))}
          </ul>
          {usedKeywords.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-500">
                본문에 반영된 네이버 키워드
              </p>
              <div className="flex flex-wrap gap-1.5">
                {usedKeywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">생성 결과</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                {copied ? "복사됨" : "복사"}
              </button>
              <button
                type="button"
                onClick={download}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                .md 저장
              </button>
            </div>
          </div>
          <ResultView md={result} />
          <p className="mt-2 text-xs text-neutral-500">
            복사하면 굵은 글씨가 유지된 채로 붙습니다. .md 저장은 원문 그대로입니다.
          </p>
        </section>
      )}
    </main>
  );
}
