// 혼자 쓰는 사이트용 로그인.
// 아이디/비밀번호는 코드에 넣지 않고 환경변수로만 받습니다(.env.local, 배포 시에는 호스팅 설정).

export const SESSION_COOKIE = "pb_session";
const SESSION_DAYS = 30;

function timingSafeEqual(a: string, b: string): boolean {
  // 길이가 달라도 도중에 빠져나가지 않고 끝까지 순회합니다.
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    // 범위를 벗어나면 charCodeAt이 NaN이라 0으로 바꿔 씁니다.
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/** 로그인 성공 시 쿠키에 담을 값. `만료시각.서명` 형태입니다. */
export async function createSession(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(expiresAt);
  return `${payload}.${await sign(payload, secret)}`;
}

/** 쿠키 값이 우리가 발급한 것이고 아직 안 지났는지 확인합니다. */
export async function verifySession(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = await sign(payload, secret);
  if (!timingSafeEqual(signature, expected)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export interface AuthConfig {
  user: string;
  password: string;
  secret: string;
}

/**
 * 환경변수가 다 채워져 있을 때만 로그인을 켭니다.
 * 하나라도 비어 있으면 null을 돌려주고, 그때는 사이트가 잠기지 않습니다.
 */
export function readAuthConfig(): AuthConfig | null {
  const user = process.env.APP_USER;
  const password = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!user || !password || !secret) return null;
  return { user, password, secret };
}

export function checkCredentials(
  config: AuthConfig,
  user: string,
  password: string,
): boolean {
  // 아이디가 틀려도 비밀번호 비교를 건너뛰지 않습니다.
  const okUser = timingSafeEqual(user, config.user);
  const okPassword = timingSafeEqual(password, config.password);
  return okUser && okPassword;
}

/** 라우트 안에서 로그인 여부를 다시 확인합니다(프록시만 믿지 않기 위해). */
export async function isAuthenticated(req: Request): Promise<boolean> {
  const config = readAuthConfig();
  if (!config) return true; // 로그인 기능이 꺼져 있으면 통과

  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(match?.[1], config.secret);
}
