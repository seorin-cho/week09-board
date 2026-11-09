# 검색·정렬·페이지네이션 게시판

Node.js 22.14.0 / Express 5.3.0 / Playwright 1.65.0. 1,000건 인메모리 배열이며 DB를 사용하지 않습니다.

## 실행

```sh
npm ci
npm start
```

http://localhost:3000 접속. PORT 환경변수로 포트를 변경할 수 있습니다.

기본 접속 주소: http://localhost:3000

3000 포트가 사용 중이면 PowerShell에서 다음과 같이 실행합니다.

    $env:PORT=3001
    npm start

이 경우 http://localhost:3001 로 접속합니다.

## 테스트

```sh
npx playwright install chromium
npm test
```

설치된 Chrome을 사용하려면 CHROME_PATH 환경변수에 실행 파일 경로를 설정합니다. 결과 JSON과 캡처는 test-results/에 생성됩니다. RESULT_DIR로 경로를 바꿀 수 있습니다. 테스트 서버는 임의 포트를 사용하고 종료합니다.

## API·정책

- /api/posts?page=1&limit=10&sort=latest&search=Redis
- /api/posts/cursor?limit=10&search=Redis&cursor=900

최신순 ID DESC, 오래된순 ID ASC, 조회순 views DESC 및 동점 id DESC. 날짜도 ID에 따라 증가하도록 생성했습니다. 커서는 ID DESC 고정, 화면 정렬 선택 비활성화입니다.
page/limit은 안전한 양의 정수 문자열만 허용하며 잘못된 값은 기본값 1/10을 적용합니다. limit 상한은 오프셋 100, 커서 50입니다. 잘못된 sort 및 __proto__/constructor/toString은 latest입니다. 검색은 제목·본문의 대소문자를 구분하지 않는 부분 문자열 검색입니다. 빈 결과는 items=[], totalPages=1, hasNext=false입니다.

## 필수 개념

1. 오프셋은 페이지 번호를 직접 선택하는 게시판·관리 목록, 커서는 순서대로 누적하는 피드·더 보기에 적합합니다.
2. 디바운스는 마지막 입력 후 300ms를 기다려 요청 횟수를 줄입니다. AbortController는 이미 시작된 이전 요청을 중단합니다. 입력 즉시 취소하며 응답 적용 직전에 signal과 요청 번호도 검사합니다.
3. 검색과 id < cursor를 먼저 적용한 뒤 limit+1개 조회합니다. 추가 한 건이 있으면 hasNext=true, 실제 반환은 limit개이며 마지막 반환 ID가 nextCursor입니다.
4. offset=(safePage-1)*limit, totalPages=max(1,ceil(totalCount/limit)), safePage=min(validPage,totalPages). 빈 결과에도 1페이지를 유지합니다.

## 원본 대비 수정

- Object.hasOwn으로 상속 정렬 키 차단, meta.sort 반환, 파라미터 전체 문자열 검증.
- 커서 제목·본문 검색, search 전달, 두 조건 적용 후 limit+1 조회.
- 입력 즉시 취소, revision 검사, HTTP 오류 표시, 요청 중 더 보기 방지.
- 검색·정렬 변경 시 page/커서/누적 목록 초기화; 수동 조회 시 타이머 제거.
- URL 복원 공통화, limit 포함 정규화, 서버 보정 페이지 반영, popstate 때 오프셋 UI 복원.
- 날짜·ID 순서 일치, 실제 SQL 실행처럼 보이던 문구를 개념 예시로 수정.
- package-lock/.gitignore/테스트 추가, HTML만 정적 제공.

상세 실측 결과와 원본 비교는 제출 묶음의 실습보고서.md, changes.patch, test-results/를 참고하세요.

## AI 활용

OpenAI Codex를 활용하여 원본 코드의 문제점을 분석하고, 정렬 키 화이트리스트 보완, 커서 API의 제목·본문 검색 추가, 비동기 요청 취소 및 오래된 응답 방지, URL 상태 복원 기능을 개선하였다. 
수정된 게시판을 http://localhost:3001에서 실행하여 다음 9가지 항목을 직접 검증하였다.
1. B-Tree 입력을 통한 제목 검색
2. 상세 본문 입력을 통한 본문 검색
3. 없는검색어12345 입력 시 결과 없음 처리
4. 최신순·오래된순·조회수순 정렬
5. 검색·정렬 변경 시 1페이지 초기화
6. 커서 모드에서 정렬 선택 상자 비활성화
7. 커서 모드에서 더 보기를 마지막까지 실행하고 종료 버튼 비활성화 확인
8. 검색어 변경 시 이전 누적 목록 초기화
9. 오프셋 모드에서 새로고침·뒤로 가기 후 URL·검색어·정렬·페이지·결과 복원
