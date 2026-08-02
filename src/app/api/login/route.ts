import {
  SESSION_COOKIE,
  checkCredentials,
  createSession,
  readAuthConfig,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const config = readAuthConfig();
  if (!config) {
    return Response.json(
      { error: "로그인이 설정되지 않았습니다. 환경변수를 확인하세요." },
      { status: 500 },
    );
  }

  let user: unknown;
  let password: unknown;
  try {
    ({ user, password } = await req.json());
  } catch {
    return Response.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  if (typeof user !== "string" || typeof password !== "string") {
    return Response.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  if (!checkCredentials(config, user, password)) {
    // 어느 쪽이 틀렸는지 알려주지 않습니다.
    return Response.json(
      { error: "아이디 또는 비밀번호가 맞지 않습니다." },
      { status: 401 },
    );
  }

  const token = await createSession(config.secret);
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${30 * 24 * 60 * 60}`,
      // 배포(https)에서만 Secure를 붙입니다. 로컬 http에서는 붙이면 쿠키가 저장되지 않습니다.
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return res;
}

/** 로그아웃 */
export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
  return res;
}
