# 스쿨모아 (School-Moa)

학교 가기 전에 오늘 수업, 급식, 공지를 한 번에 확인할 수 있게 만든 웹앱입니다.

쉽게 말하면,
학생이 "오늘 뭐 준비해야 하지?"를 빠르게 해결하도록 만든 프로젝트입니다.

---

## 이 프로젝트는 무엇인가요?

- 한 줄 소개: 학교 정보를 모아 보여주는 학생용 웹앱
- 만든 이유: 수업 내용/준비물/급식/공지가 흩어져 있어 불편해서
- 대상: 초중고 학생, 선생님


---

## 처음 보는 사람을 위한 핵심 기능 5가지

1. 홈 화면
- 다음 수업, 오늘 급식, 공지 미리보기를 바로 보여줍니다.

2. 시간표
- 요일별 시간표를 볼 수 있습니다.
- 수업 상세 내용, 준비물, 댓글(질문)까지 확인할 수 있습니다.


3. 급식
- 요일별 급식 메뉴/칼로리/알레르기 정보를 보여줍니다.
- 별점과 한줄평을 남길 수 있습니다.


4. 게시판
- 반별 게시판을 만들고 글/댓글을 작성할 수 있습니다.
- 공지 고정 기능, 초대코드/초대링크 공유 기능이 있습니다.

5. 교사 계정
- 회원가입, 로그인, 비밀번호 변경, 계정 삭제가 가능합니다.
- 로그인 실패가 반복되면 계정 잠금이 적용됩니다.
- 복구코드로 비밀번호 초기화가 가능합니다.

---

## 기술 구성

- 프런트엔드: HTML, CSS, JavaScript(바닐라)
- 백엔드: Node.js 내장 HTTP 서버
- 외부 API: NEIS Open API
- 선택 기능: Redis(요청 제한 저장소)

---

## 프로젝트 구조

    vibe_coding 1/
    ├── index.html              # 화면 뼈대
    ├── styles.css              # 스타일
    ├── app.js                  # 프런트 로직(탭/렌더링/상태)
    ├── server.js               # API 프록시/보안/정적 파일 서빙
    ├── .env.example            # 환경변수 예시
    ├── .gitignore              # Git 제외 목록
    ├── data/
    │   └── teachers.json       # 교사 계정/세션 저장
    ├── logs/                   # 보안/오류 로그
    └── readme.md

---

# 웹 사이트

[https://schoolmoa63970.azurewebsites.net/](https://schoolmoa63970.azurewebsites.net/)

위 주소로 접속하여 사용해보세요!


---

## 서버 API 한눈에 보기

조회 API
- GET /api/schools
- GET /api/school-search?q=학교명
- GET /api/meal?date=YYYYMMDD
- GET /api/timetable?date=YYYYMMDD

교사 인증 API
- GET /api/teacher-auth/list
- POST /api/teacher-auth/register
- POST /api/teacher-auth/login
- POST /api/teacher-auth/change-password
- POST /api/teacher-auth/delete
- POST /api/teacher-auth/recover

---

## 보안에서 신경 쓴 점

- API 키는 서버(.env)에만 보관
- 보안 헤더(CSP 등) 적용
- 입력값 검증 + HTML 이스케이프(XSS 방지)
- 요청 속도 제한(메모리/Redis)
- 로그 파일 기록

---

## 현재 진행 상태

- 완료: 시간표/급식/게시판/교사인증/학교검색
- 진행 중: UI/UX 개선, 운영 배포 품질 강화

---

## 만든 사람

백준기