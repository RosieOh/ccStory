~/.claude/plans + projects 라이브 정보 반영 계획

목표





항상 사용자 홈의 실제 경로에서만 읽기: path.join(home, '.claude', 'projects'), path.join(home, '.claude', 'plans').



복사해 둔 [asstes/](asstes/) 스냅샷은 런타임 데이터 소스로 쓰지 않음 (개발 참고용이면 .gitignore에 추가해 커밋 제외 권장).

현재 상태





[electron/indexer.ts](electron/indexer.ts) / [electron/main.ts](electron/main.ts): claudeRoot = defaultClaudeProjectsRoot() → projects만 전체 인덱싱 + chokidar.



plans는 미연동. 세션 JSONL 안에 ~/.claude/plans/*.md 경로 문자열이 등장하는 경우는 있으나, 플랜 본문은 별도 파일입니다.

설계 방향

flowchart TB
  subgraph fs [ReadOnly_home]
    P["/.claude/projects"]
    L["/.claude/plans"]
  end
  subgraph main [Electron_main]
    IP[indexer_projects]
    IL[indexer_plans_md]
    DB[(SQLite)]
  end
  P --> IP
  L --> IL
  IP --> DB
  IL --> DB





projects: 기존 로직 유지 ([electron/claudeLayout.ts](electron/claudeLayout.ts), [electron/indexer.ts](electron/indexer.ts)).



plans: ~/.claude/plans 아래 **/*.md를 얕은 깊이로 수집, 파일 단위로 mtime 비교 후 증분 인덱스.

데이터 모델 (SQLite)

새 테이블 예시 (이름은 구현 시 조정 가능):





plan_files: id, file_path (UNIQUE), file_mtime_ms, title (파일명 또는 첫 # 헤딩에서 추출), body (전체 Markdown 텍스트).



plan_files_fts: FTS5 content='plan_files', content_rowid='id' + 기존 messages와 동일한 트리거 패턴 ([electron/db.ts](electron/db.ts) 마이그레이션으로 스키마 버전 증가).

세션 메시지 FTS와 분리하면 구현·쿼리가 단순하고, 검색 시 source 필터로 합치기 쉽습니다.

인덱싱·감시





[electron/claudeLayout.ts](electron/claudeLayout.ts) 또는 신규 electron/plansIndexer.ts: listMarkdownPlans(plansRoot), indexPlanFileSync(db, absPath).



[electron/main.ts](electron/main.ts): plansRoot = path.join(home, '.claude', 'plans'); app.whenReady에서 plans 풀 스캔(또는 fullReindex 확장).



chokidar: 기존 projects 패턴에 더해 path.join(plansRoot, '**', '*.md') 구독; 변경 시 해당 파일만 재인덱스 후 broadcastIndexUpdated().



[indexSinglePath](electron/indexer.ts)와 유사하게, 경로가 .claude/plans이면 plan 테이블만 갱신하는 분기 추가.

IPC·검색·UI





[shared/ipc.ts](shared/ipc.ts): 예) plansList, planSearch, planBody 또는 search에 scope: 'messages' | 'plans' | 'all' + PlanHit DTO.



[electron/search.ts](electron/search.ts): plan_files_fts용 쿼리 + 기존 messages_fts와 OR/UNION 또는 앱 레벨에서 두 결과 병합(한쪽이 비면 단순).



[src/App.tsx](src/App.tsx): 검색 탭에 소스 토글 (대화 / 플랜 / 전체), 플랜 결과는 Markdown 미리보기 + 복사; 필요 시 사이드바에 최근 플랜 블록.

문서





[docs/architecture.md](docs/architecture.md): projects vs plans 경로, 읽기 전용, 인덱스 테이블 설명.



[docs/decisions/](docs/decisions/)에 짧은 ADR: 플랜을 별도 FTS 테이블로 둔 이유.

후속(선택)





세션 본문에 나오는 ~/.claude/plans/…\.md 경로를 파싱해 “관련 플랜 열기” 링크 (IPC로 해당 plan_files row 조회).



CLAUDE_HOME 환경 변수로 루트 오버라이드 (팀/테스트용).

범위 밖





앱 번들/asstes 폴더를 데이터 소스로 쓰는 것.



plans 아래 비-Markdown 확장자까지 무조건 인덱싱 (필요 시 이후 확장).

