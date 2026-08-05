<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 커밋 · 푸시 · 배포는 요청받았을 때만

`git commit`, `git push`, `vercel deploy`는 사용자가 그때 명시적으로 시킬 때만 실행합니다.

- 코드를 고친 뒤 "빌드 통과했습니다"까지만 보고하고 멈춥니다. 이어서 커밋하지 않습니다.
- 이전에 "커밋 푸시해줘"라고 했던 것은 그때 한 번의 승인입니다. 다음 작업까지 이어지지 않습니다.
- "고쳐줘", "추가해줘"는 커밋 요청이 아닙니다.
- 커밋 전에는 staged diff에서 `sk-ant-api`, 비밀번호 문자열을 확인하고, 나오면 중단합니다.

저장소가 공개(public)라 소스에 비밀값이 들어가면 안 됩니다.
`.env.local`은 절대 커밋하지 않습니다.
