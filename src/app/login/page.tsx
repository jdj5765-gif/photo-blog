"use client";

import { useState } from "react";

export default function LoginPage() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "로그인에 실패했습니다.");
      }
      // 쿠키가 붙은 뒤 원래 가려던 곳으로 보냅니다.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
      setLoading(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-400";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-xl font-bold tracking-tight">사진 → 블로그 초안</h1>
      <p className="mt-1.5 mb-6 text-sm text-neutral-500">
        로그인이 필요합니다.
      </p>

      <form onSubmit={submit} className="grid gap-3">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="user">
            아이디
          </label>
          <input
            id="user"
            className={inputCls}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="password">
            비밀번호
          </label>
          <input
            id="password"
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !user || !password}
          className="mt-2 rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {loading ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
