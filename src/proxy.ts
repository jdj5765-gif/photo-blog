import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readAuthConfig, verifySession } from "@/lib/auth";

// 로그인 없이 열려 있어야 하는 경로
const PUBLIC_PATHS = ["/login", "/api/login"];

export async function proxy(request: NextRequest) {
  const config = readAuthConfig();
  // 환경변수가 없으면 로그인을 켜지 않습니다(로컬에서 그냥 쓰던 대로 동작).
  if (!config) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, config.secret)) {
    return NextResponse.next();
  }

  // API는 리다이렉트 대신 401을 돌려줘야 화면에서 오류를 제대로 표시할 수 있습니다.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 파일과 이미지 최적화 경로는 건드리지 않습니다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
