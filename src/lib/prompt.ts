import { STYLE_GUIDE, REFERENCE_EXAMPLES } from "./style-guide";
import { ALL_NAVER_KEYWORDS } from "./naver-keywords";

export type PostType = "restaurant" | "product";

/** 방문 기록. 사진만으로는 알 수 없어서 사용자가 직접 채워야 하는 값입니다. */
export interface VisitInfo {
  /** 도착 시각 "18:30" */
  arrivalTime: string;
  /** 웨이팅이 있었는지 */
  waited: "있음" | "없음";
  /** 웨이팅이 있었다면 기다린 분 */
  waitMinutes?: string;
}

export interface GenerateOptions {
  postType: PostType;
  /** 상호명 / 제품명 */
  subject?: string;
  /** 지역 (예: 을지로3가) — 제목·해시태그의 핵심 키워드 */
  location?: string;
  /** 상단 불릿으로 올릴 핵심 포인트 */
  highlights?: string[];
  /** 사용자가 직접 고른 네이버 키워드 리뷰 문구 (비우면 AI가 사진 보고 선택) */
  naverKeywords?: string[];
  /** 플레이스에서 가져온, 방문자가 실제로 많이 고른 키워드 (많이 고른 순) */
  keywordVotes?: { name: string; count: number }[];
  /** 방문 기록 — 필수. 도입부에 반드시 들어갑니다. */
  visit?: VisitInfo;
  /** 가격, 영업시간, 방문일 등 사용자가 아는 사실 */
  facts?: string;
  /** 추가 요청 사항 */
  extra?: string;
}

const TYPE_GUIDE: Record<PostType, string> = {
  restaurant: `
[맛집 리뷰 전용 지침]
- 메뉴를 설명할 때는 식감·온도·간·향 중 최소 두 가지를 언급합니다.
- 웨이팅, 예약(캐치테이블), 주차, 좌석 형태, 콜키지 정책처럼 방문 전 궁금한 정보를
  사진과 주어진 정보에서 확인되는 범위 안에서 반드시 짚어줍니다.
- 야외 좌석(야장)이 있는 가게라면 분위기 묘사에 조명·계절감·소음 수준을 넣습니다.`,
  product: `
[제품 리뷰 전용 지침]
- 뼈대의 3)웨이팅 항목은 '구매 경로/가격대'로, 5)단체모임 항목은 '이런 분께 추천'으로 대체합니다.
- 스펙은 사진에서 읽히는 것만 적고, 나머지는 빈칸 '____'로 남깁니다.
- 장점 3개 이상, 아쉬운 점 최소 1개를 반드시 포함해 신뢰도를 확보합니다.`,
};

/** 네이버 키워드를 제목에 넣을 때 쓰는 명사형 변환 예시 */
const KEYWORD_TITLE_RULE = `
[네이버 키워드를 제목에 넣는 법]
- '~해요/~있어요' 형태를 제목에서는 명사형·수식형으로 바꿔 씁니다.
  "단체모임 하기 좋아요" → "단체모임 맛집" / "단체모임 하기 좋은 곳"
  "야외공간이 멋져요"   → "야장 맛집" / "야외 테라스"
  "룸이 잘 되어있어요"  → "룸 있는 맛집"
  "가성비가 좋아요"     → "가성비 맛집"
  "특별한 날 가기 좋아요" → "기념일 맛집"
  "주차하기 편해요"     → "주차 가능"
- 제목 후보 3개에는 서로 다른 키워드 조합을 씁니다(같은 제목의 변형 금지).
- 제목은 3개 모두 공백 포함 30~40자를 지킵니다.
- 본문에서는 원문 표현("단체모임 하기 좋아요")을 그대로 써도 됩니다.`;

export function buildSystemPrompt(opts: GenerateOptions): string {
  const blocks = [
    `당신은 한국어 블로그 리뷰 작성 전문가입니다. 사용자가 올린 사진과 정보만을 근거로 네이버 블로그용 SEO 최적화 리뷰 초안을 작성합니다.`,
    `아래 스타일 가이드를 반드시 지키십시오.\n\n${STYLE_GUIDE}`,
    TYPE_GUIDE[opts.postType].trim(),
    KEYWORD_TITLE_RULE.trim(),
  ];

  if (REFERENCE_EXAMPLES.length > 0) {
    blocks.push(
      `[말투 예시] — 아래는 목소리를 잡기 위한 발췌입니다.
글의 구성과 순서는 참고하지 마십시오. 뼈대는 위 스타일 가이드를 따릅니다.
어미, 문장 길이, 감정 표현, 웃음 표기(ㅎㅎ/ㅋㅋㅋ)의 밀도만 이만큼 맞추십시오.
문장을 그대로 베끼지 말고, 소재가 달라도 같은 사람이 쓴 것처럼 들리게 씁니다.\n\n${REFERENCE_EXAMPLES.join(
        "\n\n---\n\n",
      )}`,
    );
  }

  blocks.push(
    `[출력 형식] 아래 마크다운 형식 그대로, 다른 설명 없이 결과만 출력합니다.

## 제목 후보
(3개 모두 공백 포함 30~40자. 쓰고 나서 글자 수를 세어 범위를 벗어나면 고쳐서 출력합니다)
1. …
2. …
3. …

## 사용한 키워드
(본문에 반영한 네이버 키워드 리뷰 문구를 쉼표로 나열)

## 메타 설명
(80~120자)

## 본문
(1번 제목 기준. 맨 위 핵심 포인트 불릿부터 시작해 스타일 가이드의 뼈대 순서를 그대로 따릅니다.
 소제목은 ###, 사진 위치는 [사진N - 식별어] 표기)

## 해시태그
#태그1 #태그2 …`,
  );

  return blocks.join("\n\n");
}

export function buildUserText(opts: GenerateOptions, imageCount: number): string {
  const lines = [
    `사진 ${imageCount}장을 첨부했습니다. 첨부 순서대로 사진1 ~ 사진${imageCount} 입니다.\n` +
      `글 흐름에 맞게 순서를 재배치해도 됩니다. 단, 표기는 '[사진N - 식별어]' 형식으로 하고 ` +
      `${imageCount}장 모두 정확히 한 번씩 등장시키세요.`,
    `리뷰 유형: ${opts.postType === "restaurant" ? "맛집" : "제품"}`,
  ];
  if (opts.visit) {
    const { arrivalTime, waited, waitMinutes } = opts.visit;
    const waitText =
      waited === "있음"
        ? `웨이팅 있었고 ${waitMinutes}분 기다렸습니다`
        : `웨이팅 없이 바로 입장했습니다`;
    lines.push(
      `[방문 기록 — 확인된 사실. 반드시 반영]\n` +
        `- 도착 시각: ${arrivalTime}\n` +
        `- 웨이팅: ${waitText}\n` +
        `이 두 가지는 본문 도입부(핵심 포인트 불릿 바로 다음 문단)에 반드시 넣습니다.\n` +
        `숫자를 나열하지 말고 문장에 녹여 씁니다.\n` +
        `예) 저녁 ${arrivalTime}쯤 도착했는데 ` +
        (waited === "있음"
          ? `이미 줄이 있어서 ${waitMinutes}분 정도 기다렸어요.`
          : `다행히 웨이팅 없이 바로 자리에 앉을 수 있었어요.`) +
        `\n뒤쪽 웨이팅 섹션에서 같은 내용을 또 반복하지 말고, 거기서는 대기 공간이나 ` +
        `예약 방법처럼 다른 이야기를 다룹니다.`,
    );
  }

  if (opts.subject?.trim()) lines.push(`상호/제품명: ${opts.subject.trim()}`);
  if (opts.location?.trim())
    lines.push(
      `지역: ${opts.location.trim()} — 제목과 해시태그에 이 지역명을 반복해 넣으세요.`,
    );

  if (opts.highlights?.length) {
    lines.push(
      `본문 맨 위 핵심 포인트 불릿(이 문구들을 그대로 사용):\n- ${opts.highlights.join("\n- ")}`,
    );
  }

  // 네이버 키워드: 사용자가 고른 게 있으면 필수 반영 + 사진 근거로 추가 선택,
  // 아무것도 안 골랐으면 전부 AI가 사진 보고 선택.
  const picked = opts.naverKeywords?.filter(Boolean) ?? [];
  if (picked.length > 0) {
    lines.push(
      `[네이버 키워드 - 필수 반영]\n- ${picked.join("\n- ")}\n` +
        `위 문구는 반드시 본문에 녹입니다. 여기에 더해, 아래 전체 목록 중 사진에서 근거가 보이는 항목을 ` +
        `2~4개 더 골라 함께 반영하세요(총 5~8개 선). 근거 없는 항목은 절대 고르지 마세요.`,
    );
  } else {
    lines.push(
      `[네이버 키워드 - AI 선택]\n` +
        `아래 전체 목록에서 사진으로 확인 가능한 항목만 5~8개 골라 본문에 반영하세요. ` +
        `추측으로 고르지 말고, 사진에 근거가 보이는 것만 선택합니다.`,
    );
  }
  lines.push(`[네이버 키워드 전체 목록]\n${ALL_NAVER_KEYWORDS.join(", ")}`);

  const votes = opts.keywordVotes?.filter((v) => v?.name) ?? [];
  if (votes.length > 0) {
    const top = votes.slice(0, 8);
    lines.push(
      `[방문자가 실제로 많이 고른 키워드 — 확인된 사실]\n` +
        top.map((v) => `- ${v.name} (${v.count}명)`).join("\n") +
        `\n이건 네이버 플레이스에 집계된 실제 방문자 평가입니다. 다음 규칙으로 씁니다.\n` +
        `- 상위 항목은 사진에 근거가 약해도 사실로 취급해 본문에 녹일 수 있습니다.\n` +
        `- 숫자(몇 명)는 본문에 쓰지 않습니다. 문장 안에 자연스럽게 풀어 씁니다.\n` +
        `  예) "재료가 신선해요"가 상위 → "국물을 내는 재료가 좋다는 평이 많은 곳입니다."\n` +
        `- 1위 항목은 이 가게의 대표 강점이므로 본문에서 한 번은 비중 있게 다룹니다.\n` +
        `- 목록을 그대로 나열하거나 "방문자 리뷰 키워드는 ~입니다" 식으로 옮겨 적지 않습니다.`,
    );
  }

  lines.push(
    `선택한 키워드는 ① 제목 후보 3개 중 최소 2개에 명사형으로 반영하고, ` +
      `② 어울리는 섹션 안에서 근거와 함께 풀어 쓰되 그 키워드가 드러나는 구절을 **굵게** 표시하고, ` +
      `③ 총평 직전에 "이런 점이 좋았습니다" 불릿으로 요약하며 각 항목의 키워드 부분을 **굵게** 표시합니다. ` +
      `또한 본문 맨 위 핵심 포인트 불릿은 각 줄을 통째로 **굵게** 표시합니다.`,
  );

  if (opts.facts?.trim()) lines.push(`확인된 정보(사실로 사용 가능): ${opts.facts.trim()}`);
  if (opts.extra?.trim()) lines.push(`추가 요청: ${opts.extra.trim()}`);

  lines.push(
    `사진에서 확인되지 않고 위에 주어지지도 않은 정보는 절대 지어내지 마세요. ` +
      `대신 그 자리를 빈칸 '____'(밑줄 4개)로 남겨 제가 채워 넣을 수 있게 하세요. ` +
      `'(확인 필요)' 같은 안내 문구는 쓰지 말고, 빈칸은 글 전체에서 5개 이하로 유지하세요.`,
  );
  return lines.join("\n\n");
}
