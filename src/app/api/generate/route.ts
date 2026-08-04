import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserText, type GenerateOptions } from "@/lib/prompt";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IMAGES = 30;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

interface ImagePayload {
  media_type: string;
  data: string; // base64, no data: prefix
}

interface RequestBody extends GenerateOptions {
  images: ImagePayload[];
}

export async function POST(req: Request) {
  // 프록시에서 이미 막지만, 비용이 드는 경로라 여기서도 확인합니다.
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요." },
      { status: 500 },
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return Response.json({ error: "사진을 최소 1장 올려주세요." }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return Response.json(
      { error: `사진은 최대 ${MAX_IMAGES}장까지 가능합니다.` },
      { status: 400 },
    );
  }
  for (const img of images) {
    if (!ALLOWED_MEDIA.has(img.media_type) || typeof img.data !== "string" || !img.data) {
      return Response.json(
        { error: "지원하지 않는 이미지 형식입니다. (jpg, png, webp, gif)" },
        { status: 400 },
      );
    }
  }

  const visit = body.visit;
  if (
    !visit ||
    typeof visit.arrivalTime !== "string" ||
    !visit.arrivalTime.trim() ||
    (visit.waited !== "있음" && visit.waited !== "없음") ||
    (visit.waited === "있음" && !String(visit.waitMinutes ?? "").trim())
  ) {
    return Response.json(
      { error: "도착 시각과 웨이팅 정보를 입력해주세요." },
      { status: 400 },
    );
  }

  const opts: GenerateOptions = {
    postType: body.postType === "product" ? "product" : "restaurant",
    subject: body.subject,
    location: body.location,
    highlights: body.highlights,
    naverKeywords: body.naverKeywords,
    keywordVotes: Array.isArray(body.keywordVotes) ? body.keywordVotes.slice(0, 20) : undefined,
    visit,
    facts: body.facts,
    extra: body.extra,
  };

  const client = new Anthropic();

  // 사진 순서를 모델이 헷갈리지 않도록 각 이미지 뒤에 번호 라벨을 붙입니다.
  const labeled: Anthropic.ContentBlockParam[] = [];
  images.forEach((img, i) => {
    labeled.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: img.data,
      },
    });
    labeled.push({ type: "text", text: `↑ [사진${i + 1}]` });
  });
  labeled.push({ type: "text", text: buildUserText(opts, images.length) });

  try {
    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(opts),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: labeled }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            controller.enqueue(
              encoder.encode("\n\n[생성이 중단되었습니다. 다른 사진으로 시도해주세요.]"),
            );
          }
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "알 수 없는 오류";
          controller.enqueue(encoder.encode(`\n\n[오류] ${msg}`));
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "API 키가 유효하지 않습니다." }, { status: 401 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "요청이 몰렸습니다. 잠시 후 다시 시도해주세요." },
        { status: 429 },
      );
    }
    const msg = err instanceof Error ? err.message : "알 수 없는 오류";
    return Response.json({ error: msg }, { status: 500 });
  }
}
