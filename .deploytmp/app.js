const STORAGE_KEY = "schoolmoa_v2";
const DAYS = ["월", "화", "수", "목", "금"];

// 보안상 API 키는 서버(.env)에만 두고, 프런트는 프록시 경로만 사용합니다.
const SCHOOL_API_CONFIG = {
  MEAL_ENDPOINT: "/api/meal",
  TIMETABLE_ENDPOINT: "/api/timetable",
};

const state = {
  activeTab: "home",
  selectedDay: currentSchoolDay(),
  data: null,
  schoolOptions: [],
  schoolSearchResults: [],
  schoolSearchQuery: "",
  mealApiSyncByDay: {},
  timetableApiSyncByDay: {},
};

const DEFAULT_DATA = {
  profile: {
    name: "",
    role: "student",
    teacherSubject: "",
    schoolId: "",
    school: "",
    officeCode: "",
    schoolCode: "",
    schoolLevel: "mis",
    grade: "1",
    classNo: "1",
    merit: 0,
    penalty: 0,
  },
  teacherAccounts: [],
  teacherSession: {
    loggedInId: "",
    token: "",
  },
  timetable: {
    월: [],
    화: [],
    수: [],
    목: [],
    금: [],
  },
  meals: {
    월: {
      menu: [],
      kcal: 0,
      allergy: "-",
      ratings: [],
      reviews: [],
    },
    화: {
      menu: [],
      kcal: 0,
      allergy: "-",
      ratings: [],
      reviews: [],
    },
    수: {
      menu: [],
      kcal: 0,
      allergy: "-",
      ratings: [],
      reviews: [],
    },
    목: {
      menu: [],
      kcal: 0,
      allergy: "-",
      ratings: [],
      reviews: [],
    },
    금: {
      menu: [],
      kcal: 0,
      allergy: "-",
      ratings: [],
      reviews: [],
    },
  },
  classRooms: [],
  activeClassRoomId: "",
  boardPosts: [],
};

const headerTitle = document.querySelector("#headerTitle");
const headerDesc = document.querySelector("#headerDesc");
const toastEl = document.querySelector("#toast");

const screens = {
  home: document.querySelector("#homeScreen"),
  timetable: document.querySelector("#timetableScreen"),
  meal: document.querySelector("#mealScreen"),
  board: document.querySelector("#boardScreen"),
  profile: document.querySelector("#profileScreen"),
};

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentSchoolDay() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) return "월";
  return DAYS[day - 1];
}

function hasSchoolApiConfig() {
  return Boolean(SCHOOL_API_CONFIG.MEAL_ENDPOINT) && Boolean(SCHOOL_API_CONFIG.TIMETABLE_ENDPOINT);
}

function getSchoolApiGuide() {
  return {
    mealEndpoint: SCHOOL_API_CONFIG.MEAL_ENDPOINT,
    timetableEndpoint: SCHOOL_API_CONFIG.TIMETABLE_ENDPOINT,
  };
}

async function loadSchoolOptions() {
  try {
    const response = await fetch("/api/schools");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.schools)) return;

    state.schoolOptions = payload.schools
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: normalizeText(item.id || "", 40),
        name: normalizeText(item.name || "", 60),
        officeCode: normalizeText(String(item.officeCode || "").toUpperCase(), 10),
        schoolCode: normalizeText(item.schoolCode || "", 10),
        level: normalizeText(String(item.level || "mis").toLowerCase(), 10),
        grade: normalizeText(item.grade || "", 2),
        classNo: normalizeText(item.classNo || "", 2),
      }))
      .filter((item) => item.id && item.name);

    if (!state.data.profile.schoolId && state.schoolOptions[0]) {
      const first = state.schoolOptions[0];
      state.data.profile.schoolId = first.id;
      state.data.profile.school = first.name;
      state.data.profile.officeCode = first.officeCode;
      state.data.profile.schoolCode = first.schoolCode;
      state.data.profile.schoolLevel = first.level || "mis";
      state.data.profile.grade = first.grade || state.data.profile.grade;
      state.data.profile.classNo = first.classNo || state.data.profile.classNo;
      persistData();
    }
  } catch (error) {
    console.warn("학교 목록 로드 실패", error);
  }
}

async function searchSchoolsByName(query) {
  const normalized = normalizeText(query || "", 40);
  if (normalized.length < 2) {
    state.schoolSearchResults = [];
    state.schoolSearchQuery = normalized;
    renderProfile();
    showToast("학교 이름을 2글자 이상 입력해 주세요");
    return;
  }

  try {
    const response = await fetch(`/api/school-search?q=${encodeURIComponent(normalized)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload && payload.ok === false) {
      state.schoolSearchResults = [];
      state.schoolSearchQuery = normalized;
      renderProfile();
      showToast(payload.message || "학교 검색 실패");
      return;
    }

    const results = Array.isArray(payload?.schools)
      ? payload.schools
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            id: normalizeText(item.id || "", 60),
            name: normalizeText(item.name || "", 80),
            officeCode: normalizeText(String(item.officeCode || "").toUpperCase(), 10),
            schoolCode: normalizeText(String(item.schoolCode || ""), 10),
            level: normalizeText(String(item.level || "mis").toLowerCase(), 10),
          }))
          .filter((item) => item.id && item.name && item.officeCode && item.schoolCode)
      : [];

    state.schoolSearchQuery = normalized;
    state.schoolSearchResults = results;
    renderProfile();

    if (!results.length) {
      showToast("검색 결과가 없어요");
      return;
    }

    showToast(`${results.length}개 학교를 찾았어요`);
  } catch (error) {
    console.warn("학교 검색 실패", error);
    state.schoolSearchResults = [];
    state.schoolSearchQuery = normalized;
    renderProfile();
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("failed to fetch") || message.includes("network")) {
      showToast("서버 연결 실패: npm start로 서버를 켜 주세요");
      return;
    }
    showToast("학교 검색 중 오류가 발생했어요");
  }
}

function getSelectedSchoolOption() {
  const selectedId = normalizeText(state.data.profile.schoolId || "", 40);
  if (!selectedId || !state.schoolOptions.length) return null;
  return state.schoolOptions.find((item) => item.id === selectedId) || null;
}

function getProfileApiOverrides() {
  const profile = state.data.profile || {};
  const officeCode = normalizeText(String(profile.officeCode || "").toUpperCase(), 10);
  const schoolCode = normalizeText(String(profile.schoolCode || ""), 10);
  const level = normalizeText(String(profile.schoolLevel || "mis").toLowerCase(), 10);
  const grade = normalizeText(String(profile.grade || ""), 2);
  const classNo = normalizeText(String(profile.classNo || ""), 2);

  const overrides = {};
  if (/^[A-Z0-9]{2,10}$/.test(officeCode)) overrides.officeCode = officeCode;
  if (/^\d{5,10}$/.test(schoolCode)) overrides.schoolCode = schoolCode;
  if (["els", "mis", "his"].includes(level)) overrides.level = level;
  if (/^\d{1,2}$/.test(grade)) overrides.grade = grade;
  if (/^\d{1,2}$/.test(classNo)) overrides.classNo = classNo;
  return overrides;
}

function buildClassRoomId(profile) {
  const schoolCode = normalizeText(String(profile.schoolCode || ""), 10).replace(/\D/g, "");
  const grade = normalizeText(String(profile.grade || ""), 2).replace(/\D/g, "");
  const classNo = normalizeText(String(profile.classNo || ""), 2).replace(/\D/g, "");
  if (!schoolCode || !grade || !classNo) return "";
  return `class-${schoolCode}-${grade}-${classNo}`;
}

function buildClassRoomName(profile) {
  const school = normalizeText(profile.school || "우리 학교", 40) || "우리 학교";
  const grade = normalizeText(String(profile.grade || ""), 2).replace(/\D/g, "");
  const classNo = normalizeText(String(profile.classNo || ""), 2).replace(/\D/g, "");
  if (!grade || !classNo) return "반 정보 미설정";
  return `${school} ${grade}학년 ${classNo}반`;
}

function ensureCurrentClassRoom() {
  const profile = state.data.profile || {};
  const roomId = buildClassRoomId(profile);
  if (!roomId) return null;

  const exists = state.data.classRooms.find((room) => room.id === roomId);
  if (!exists) {
    state.data.classRooms.push({
      id: roomId,
      name: buildClassRoomName(profile),
      inviteCode: roomIdToInviteCode(roomId),
    });
  }

  if (!state.data.activeClassRoomId) {
    state.data.activeClassRoomId = roomId;
  }

  return roomId;
}

function roomIdToInviteCode(roomId) {
  // class-{schoolCode}-{grade}-{classNo} → {schoolCode}-{grade}학년{classNo}반
  const inner = String(roomId || "").replace(/^class-/, "");
  const parts = inner.split("-");
  if (parts.length >= 3) {
    const [schoolCode, grade, classNo] = parts;
    return `${schoolCode}-${grade}학년${classNo}반`;
  }
  return inner;
}

function buildInviteLink(inviteCode) {
  const base = `${location.protocol}//${location.host}${location.pathname}`;
  return `${base}?joinRoom=${encodeURIComponent(inviteCode)}`;
}

function inviteCodeToRoomId(code) {
  // {schoolCode}-{grade}학년{classNo}반 → class-{schoolCode}-{grade}-{classNo}
  const cleaned = normalizeText(String(code || "").replace(/\s/g, ""), 60);
  const match = cleaned.match(/^(\d{5,10})-(\d{1,2})학년(\d{1,2})반$/);
  if (match) {
    const [, schoolCode, grade, classNo] = match;
    return `class-${schoolCode}-${grade}-${classNo}`;
  }
  // 구형 직접 코드(class-xxx-g-c 형태) 허용
  if (/^class-\d{5,10}-\d{1,2}-\d{1,2}$/.test(cleaned)) return cleaned;
  return "";
}

function getRoomNameFromRoomId(roomId) {
  const inner = String(roomId || "").replace(/^class-/, "");
  const parts = inner.split("-");
  if (parts.length >= 3) {
    const [schoolCode, grade, classNo] = parts;
    return `${grade}학년 ${classNo}반 (${schoolCode})`;
  }
  return roomId;
}

function toYmdFromDay(dayLabel) {
  const now = new Date();
  const monday = new Date(now);
  const offsetFromMonday = (now.getDay() + 6) % 7;
  monday.setDate(now.getDate() - offsetFromMonday);

  const target = new Date(monday);
  target.setDate(monday.getDate() + DAYS.indexOf(dayLabel));

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function stripHtmlAndTrim(text) {
  return String(text || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKcal(raw) {
  const cleaned = String(raw || "").replace(/,/g, "");
  const match = cleaned.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseMealApiResponse(payload) {
  if (!payload || typeof payload !== "object") return null;

  if (Array.isArray(payload.mealServiceDietInfo)) {
    const rows = payload.mealServiceDietInfo.find((item) => item && Array.isArray(item.row));
    const row = rows && rows.row && rows.row[0];
    if (row) {
      return {
        menu: stripHtmlAndTrim(row.DDISH_NM)
          .split(/\n/)
          .map((item) => normalizeText(item.replace(/\([^)]*\)/g, ""), 30))
          .filter(Boolean),
        kcal: parseKcal(row.CAL_INFO),
        allergy: normalizeText(stripHtmlAndTrim(row.ALLERGY_INFO || "-"), 50) || "-",
      };
    }
  }

  if (Array.isArray(payload.menu) || payload.kcal || payload.allergy) {
    return {
      menu: Array.isArray(payload.menu)
        ? payload.menu.map((item) => normalizeText(item, 30)).filter(Boolean)
        : [],
      kcal: parseKcal(payload.kcal),
      allergy: normalizeText(payload.allergy || "-", 50) || "-",
    };
  }

  return null;
}

function buildSchoolApiRequest(endpoint, dayLabel) {
  const ymd = toYmdFromDay(dayLabel);
  const separator = endpoint.includes("?") ? "&" : "?";
  const schoolId = normalizeText(state.data.profile.schoolId || "", 40);
  const schoolQuery = schoolId ? `&schoolId=${encodeURIComponent(schoolId)}` : "";
  const overrides = getProfileApiOverrides();
  const overrideQuery = Object.entries(overrides)
    .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("");
  const overrideKey = Object.entries(overrides)
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  return {
    url: `${endpoint}${separator}date=${encodeURIComponent(ymd)}${schoolQuery}${overrideQuery}`,
    dayKey: `${dayLabel}-${ymd}-${schoolId || "none"}-${overrideKey || "default"}`,
  };
}

async function syncMealFromApi(dayLabel, options = {}) {
  if (!hasSchoolApiConfig()) return false;

  const silent = Boolean(options.silent);
  const request = buildSchoolApiRequest(SCHOOL_API_CONFIG.MEAL_ENDPOINT, dayLabel);
  if (state.mealApiSyncByDay[dayLabel] === request.dayKey) return true;

  try {
    const response = await fetch(request.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (payload && payload.ok === false) {
      if (!silent && payload.message) showToast(payload.message);
      return false;
    }
    const parsed = parseMealApiResponse(payload.meal || payload);
    if (!parsed || !parsed.menu.length) throw new Error("급식 데이터 형식 오류");

    const current = state.data.meals[dayLabel] || { ratings: [], reviews: [] };
    state.data.meals[dayLabel] = {
      menu: parsed.menu,
      kcal: parsed.kcal,
      allergy: parsed.allergy,
      ratings: Array.isArray(current.ratings) ? current.ratings : [],
      reviews: Array.isArray(current.reviews) ? current.reviews : [],
    };

    state.mealApiSyncByDay[dayLabel] = request.dayKey;
    persistData();

    if (state.activeTab === "meal") renderMeal();
    if (state.activeTab === "home") renderHome();
    if (!silent) showToast("급식 API 반영 완료");
    return true;
  } catch (error) {
    console.warn("급식 API 호출 실패", error);
    if (!silent) showToast("API 호출 실패: 기본 급식 데이터를 사용해요");
    return false;
  }
}

function parseTimetableApiResponse(payload) {
  if (!payload || typeof payload !== "object") return [];

  if (Array.isArray(payload.timetable)) {
    return payload.timetable
      .filter((row) => row && typeof row === "object")
      .map((row, index) => {
        const period = normalizeText(row.period || `${index + 1}교시`, 20) || `${index + 1}교시`;
        const subject = normalizeText(row.subject || "", 30);
        const teacher = normalizeText(row.teacher || "선생님", 40) || "선생님";
        const time = normalizeText(row.time || "", 20) || "-";
        const content = normalizeText(row.content || `${subject || "수업"} 수업`, 300);
        return {
          period,
          time,
          subject: subject || "수업",
          teacher,
          content,
          materials: [],
        };
      });
  }

  const tableKeys = ["hisTimetable", "misTimetable", "elsTimetable"];
  for (const key of tableKeys) {
    if (!Array.isArray(payload[key])) continue;
    const rowsWrap = payload[key].find((item) => item && Array.isArray(item.row));
    if (!rowsWrap || !Array.isArray(rowsWrap.row)) continue;
    return rowsWrap.row
      .filter((row) => row && typeof row === "object")
      .map((row, index) => {
        const period = normalizeText(row.PERIO || `${index + 1}교시`, 20) || `${index + 1}교시`;
        const subject =
          normalizeText(row.ITRT_CNTNT || row.SUBJECT || row.SBJ_NM || "", 30) || "수업";
        const teacher = normalizeText(row.TEACHER_NM || row.TCHR_NM || "선생님", 40) || "선생님";
        const time = normalizeText(row.TIME || "", 20) || "-";
        return {
          period,
          time,
          subject,
          teacher,
          content: normalizeText(`${subject} 수업`, 300),
          materials: [],
        };
      });
  }

  return [];
}

async function syncTimetableFromApi(dayLabel, options = {}) {
  if (!hasSchoolApiConfig()) return false;

  const silent = Boolean(options.silent);
  const request = buildSchoolApiRequest(SCHOOL_API_CONFIG.TIMETABLE_ENDPOINT, dayLabel);
  if (state.timetableApiSyncByDay[dayLabel] === request.dayKey) return true;

  try {
    const response = await fetch(request.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (payload && payload.ok === false) {
      if (!silent && payload.message) showToast(payload.message);
      return false;
    }
    const lessons = parseTimetableApiResponse(payload);
    if (!lessons.length) throw new Error("시간표 데이터 형식 오류");

    const current = state.data.timetable[dayLabel] || [];
    state.data.timetable[dayLabel] = lessons.map((lesson, index) => ({
      ...lesson,
      comments: Array.isArray(current[index]?.comments) ? current[index].comments : [],
      materials:
        Array.isArray(lesson.materials) && lesson.materials.length
          ? lesson.materials
          : Array.isArray(current[index]?.materials)
            ? current[index].materials
            : [],
    }));

    state.timetableApiSyncByDay[dayLabel] = request.dayKey;
    persistData();

    if (state.activeTab === "timetable") renderTimetable();
    if (state.activeTab === "home") renderHome();
    if (!silent) showToast("시간표 API 반영 완료");
    return true;
  } catch (error) {
    console.warn("시간표 API 호출 실패", error);
    if (!silent) showToast("시간표 API 호출 실패: 기본 데이터를 사용해요");
    return false;
  }
}

function normalizeText(input, maxLen) {
  return String(input)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function normalizeOfficeCodeInput(value) {
  const normalized = normalizeText(String(value || "").toUpperCase(), 10);
  if (!normalized) return "";
  if (normalized.startsWith("YOUR") || normalized.includes("_")) return "";
  return normalized;
}

function normalizeSchoolCodeInput(value) {
  const normalized = normalizeText(String(value || ""), 20);
  if (!normalized) return "";
  if (normalized.toUpperCase().startsWith("YOUR") || normalized.includes("_")) return "";
  const digits = normalized.replace(/\D/g, "");
  return digits.slice(0, 10);
}

function normalizeTeacherAccountId(value) {
  return normalizeText(String(value || "").toLowerCase(), 20);
}

async function hashText(value) {
  const text = String(value || "");
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch (_) {
    // 해시 API 실패 시 아래 fallback 사용
  }

  // 구형 브라우저 fallback (보안 강도는 낮음)
  try {
    return btoa(unescape(encodeURIComponent(text)));
  } catch (_) {
    return normalizeText(text, 120);
  }
}

function getTeacherSessionId() {
  return normalizeTeacherAccountId(state.data?.teacherSession?.loggedInId || "");
}

function getTeacherSessionToken() {
  return normalizeText(state.data?.teacherSession?.token || "", 120);
}

function getLoggedInTeacherAccount() {
  const accountId = getTeacherSessionId();
  if (!accountId || !Array.isArray(state.data?.teacherAccounts)) return null;
  return state.data.teacherAccounts.find((item) => item.id === accountId) || null;
}

function clearTeacherSession() {
  if (!state.data.teacherSession || typeof state.data.teacherSession !== "object") {
    state.data.teacherSession = { loggedInId: "", token: "" };
    return;
  }
  state.data.teacherSession.loggedInId = "";
  state.data.teacherSession.token = "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }
  return { ok: response.ok, status: response.status, payload };
}

async function loadTeacherAccountsFromServer() {
  try {
    const teacherId = getTeacherSessionId();
    const teacherToken = getTeacherSessionToken();
    const headers = {};
    if (teacherId && teacherToken) {
      headers["x-teacher-id"] = teacherId;
      headers["x-teacher-token"] = teacherToken;
    }

    const result = await requestJson("/api/teacher-auth/list", {
      headers,
    });
    if (!result.ok) return false;
    state.teacherAccountCount = Number(result.payload?.count || 0);
    const accounts = Array.isArray(result.payload.accounts) ? result.payload.accounts : [];
    state.data.teacherAccounts = accounts
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: normalizeTeacherAccountId(item.id),
        name: normalizeText(item.name || "", 40),
        subject: normalizeText(item.subject || "", 30),
        passwordHash: "",
        createdAt: normalizeText(item.createdAt || "", 40),
      }))
      .filter((item) => item.id);
    return true;
  } catch (_) {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 1500);
}

function avg(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function hasLegacySampleData(data) {
  if (!data || typeof data !== "object") return false;

  const profileName = String(data.profile?.name || "").trim();
  const profileSchool = String(data.profile?.school || "").trim();
  const profileHit =
    profileName === "사용자" ||
    profileName === "백준기" ||
    profileSchool === "우리학교" ||
    profileSchool === "대구왕선초등학교";

  const sampleBoardTitles = ["현장체험학습 안내", "독서 발표 준비"];
  const sampleMeals = ["흑미밥", "미역국", "닭갈비", "짜장밥"];
  const sampleSubjects = ["국어", "수학", "과학", "영어", "사회", "음악"];

  const boardHit = Array.isArray(data.boardPosts)
    ? data.boardPosts.some((post) => sampleBoardTitles.includes(String(post?.title || "")))
    : false;

  const mealHit = DAYS.some((day) => {
    const menu = data.meals?.[day]?.menu;
    return Array.isArray(menu) && menu.some((item) => sampleMeals.includes(String(item || "")));
  });

  const timetableHit = DAYS.some((day) => {
    const lessons = data.timetable?.[day];
    return (
      Array.isArray(lessons) &&
      lessons.some((lesson) => sampleSubjects.includes(String(lesson?.subject || "")))
    );
  });

  return profileHit || boardHit || mealHit || timetableHit;
}

function safeLoadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepCopy(DEFAULT_DATA);

    const parsed = JSON.parse(raw);
    const sanitized = sanitizeData(parsed);
    if (hasLegacySampleData(sanitized)) {
      return deepCopy(DEFAULT_DATA);
    }
    return sanitized;
  } catch (error) {
    console.warn("저장 데이터 로드 실패", error);
    showToast("저장 데이터 읽기 실패, 기본값으로 시작해요");
    return deepCopy(DEFAULT_DATA);
  }
}

function persistData() {
  try {
    const toSave = deepCopy(state.data);
    if (toSave.teacherSession && typeof toSave.teacherSession === "object") {
      toSave.teacherSession.token = "";
      if (!toSave.teacherSession.token) {
        toSave.teacherSession.loggedInId = "";
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.warn("저장 실패", error);
    showToast("저장 실패: 앱은 계속 사용할 수 있어요");
  }
}

function sanitizeData(data) {
  const fallback = deepCopy(DEFAULT_DATA);

  if (!data || typeof data !== "object") return fallback;

  const profile = data.profile && typeof data.profile === "object" ? data.profile : fallback.profile;

  const safe = {
    profile: {
      name: normalizeText(profile.name || fallback.profile.name, 40) || fallback.profile.name,
      role: ["student", "teacher"].includes(normalizeText(profile.role || "", 20))
        ? normalizeText(profile.role || "", 20)
        : fallback.profile.role,
      teacherSubject: normalizeText(profile.teacherSubject || fallback.profile.teacherSubject, 30),
      schoolId: normalizeText(profile.schoolId || fallback.profile.schoolId, 40) || fallback.profile.schoolId,
      school: normalizeText(profile.school || fallback.profile.school, 60) || fallback.profile.school,
      officeCode: normalizeOfficeCodeInput(profile.officeCode || fallback.profile.officeCode),
      schoolCode: normalizeSchoolCodeInput(profile.schoolCode || fallback.profile.schoolCode),
      schoolLevel:
        normalizeText(String(profile.schoolLevel || fallback.profile.schoolLevel).toLowerCase(), 10) ||
        fallback.profile.schoolLevel,
      grade: normalizeText(profile.grade || fallback.profile.grade, 20) || fallback.profile.grade,
      classNo: normalizeText(profile.classNo || fallback.profile.classNo, 20) || fallback.profile.classNo,
      merit: Number.isFinite(profile.merit) ? profile.merit : fallback.profile.merit,
      penalty: Number.isFinite(profile.penalty) ? profile.penalty : fallback.profile.penalty,
    },
    teacherAccounts: deepCopy(fallback.teacherAccounts),
    teacherSession: deepCopy(fallback.teacherSession),
    timetable: deepCopy(fallback.timetable),
    meals: deepCopy(fallback.meals),
    classRooms: deepCopy(fallback.classRooms),
    activeClassRoomId: normalizeText(data.activeClassRoomId || fallback.activeClassRoomId, 60),
    boardPosts: deepCopy(fallback.boardPosts),
  };

  if (data.timetable && typeof data.timetable === "object") {
    DAYS.forEach((day) => {
      if (!Array.isArray(data.timetable[day])) return;
      safe.timetable[day] = data.timetable[day]
        .filter((lesson) => lesson && typeof lesson === "object")
        .map((lesson, index) => {
          const fallbackLesson =
            fallback.timetable[day][index] ||
            fallback.timetable[day][0] || {
              period: `${index + 1}교시`,
              time: "-",
              subject: "수업",
              teacher: "선생님",
              content: "",
              materials: [],
            };
          return {
            period: normalizeText(lesson.period || fallbackLesson.period, 20) || fallbackLesson.period,
            time: normalizeText(lesson.time || fallbackLesson.time, 20) || fallbackLesson.time,
            subject: normalizeText(lesson.subject || fallbackLesson.subject, 30) || fallbackLesson.subject,
            teacher: normalizeText(lesson.teacher || fallbackLesson.teacher, 40) || fallbackLesson.teacher,
            content: normalizeText(lesson.content || fallbackLesson.content, 300) || fallbackLesson.content,
            materials: Array.isArray(lesson.materials)
              ? lesson.materials.map((m) => normalizeText(m, 40)).filter(Boolean)
              : fallbackLesson.materials,
            comments: Array.isArray(lesson.comments)
              ? lesson.comments
                  .filter((c) => c && typeof c === "object")
                  .map((c) => ({
                    author: normalizeText(c.author || "나", 20) || "나",
                    text: normalizeText(c.text || "", 120),
                  }))
                  .filter((c) => c.text)
              : [],
          };
        });
    });
  }

  if (data.meals && typeof data.meals === "object") {
    DAYS.forEach((day) => {
      const meal = data.meals[day];
      const fallbackMeal = fallback.meals[day];
      if (!meal || typeof meal !== "object") return;
      safe.meals[day] = {
        menu: Array.isArray(meal.menu)
          ? meal.menu.map((item) => normalizeText(item, 30)).filter(Boolean)
          : fallbackMeal.menu,
        kcal: Number.isFinite(meal.kcal) ? meal.kcal : fallbackMeal.kcal,
        allergy: normalizeText(meal.allergy || fallbackMeal.allergy, 50) || fallbackMeal.allergy,
        ratings: Array.isArray(meal.ratings)
          ? meal.ratings.filter((value) => Number.isInteger(value) && value >= 1 && value <= 5)
          : [],
        reviews: Array.isArray(meal.reviews)
          ? meal.reviews
              .filter((r) => r && typeof r === "object")
              .map((r) => ({
                author: normalizeText(r.author || "나", 20) || "나",
                text: normalizeText(r.text || "", 120),
              }))
              .filter((r) => r.text)
          : [],
      };
    });
  }

  if (Array.isArray(data.classRooms)) {
    safe.classRooms = data.classRooms
      .filter((room) => room && typeof room === "object")
      .map((room) => ({
        id: normalizeText(room.id || "", 60),
        name: normalizeText(room.name || "", 80),
      }))
      .filter((room) => room.id && room.name);
  }

  if (Array.isArray(data.teacherAccounts)) {
    safe.teacherAccounts = data.teacherAccounts
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: normalizeTeacherAccountId(item.id),
        name: normalizeText(item.name || "", 40),
        subject: normalizeText(item.subject || "", 30),
        passwordHash: normalizeText(item.passwordHash || "", 200),
        createdAt: normalizeText(item.createdAt || "", 40),
      }))
      .filter((item) => item.id && item.passwordHash);
  }

  if (data.teacherSession && typeof data.teacherSession === "object") {
    safe.teacherSession = {
      loggedInId: normalizeTeacherAccountId(data.teacherSession.loggedInId || ""),
      token: normalizeText(data.teacherSession.token || "", 120),
    };
  }

  if (!safe.teacherSession.token) {
    safe.teacherSession.loggedInId = "";
  }

  if (
    safe.teacherSession.loggedInId &&
    !safe.teacherAccounts.some((item) => item.id === safe.teacherSession.loggedInId)
  ) {
    safe.teacherSession.loggedInId = "";
    safe.teacherSession.token = "";
  }

  if (Array.isArray(data.boardPosts)) {
    safe.boardPosts = data.boardPosts
      .filter((p) => p && typeof p === "object")
      .map((post, index) => {
        const fallbackPost =
          fallback.boardPosts[index] ||
          fallback.boardPosts[0] || {
            id: Date.now() + index,
            pinned: false,
            title: "",
            date: "",
            body: "",
            comments: [],
          };
        return {
          id: Number.isFinite(post.id) ? post.id : Date.now() + index,
          pinned: Boolean(post.pinned),
          roomId: normalizeText(post.roomId || "", 60),
          title: normalizeText(post.title || fallbackPost.title, 60) || fallbackPost.title,
          date: normalizeText(post.date || fallbackPost.date, 20) || fallbackPost.date,
          body: normalizeText(post.body || fallbackPost.body, 500) || fallbackPost.body,
          comments: Array.isArray(post.comments)
            ? post.comments
                .filter((c) => c && typeof c === "object")
                .map((c) => ({
                  author: normalizeText(c.author || "나", 20) || "나",
                  text: normalizeText(c.text || "", 120),
                }))
                .filter((c) => c.text)
            : [],
        };
      });
  }

  return safe;
}

function renderDayButtons(selected, type) {
  return `<div class="day-selector" role="tablist">${DAYS.map(
    (day) => `<button class="day-btn ${selected === day ? "is-active" : ""}" data-day="${day}" data-type="${type}" role="tab" aria-selected="${selected === day}">${day}</button>`
  ).join("")}</div>`;
}

function renderHome() {
  const day = state.selectedDay;
  void syncMealFromApi(day, { silent: true });
  void syncTimetableFromApi(day, { silent: true });
  const isTeacherMode = state.data.profile?.role === "teacher";
  const firstLesson = state.data.timetable[day]?.[0] || {
    period: "-",
    subject: "시간표 없음",
    time: "-",
    teacher: "-",
  };
  const meal = state.data.meals[day] || { menu: [], kcal: 0, allergy: "-", ratings: [] };
  const pinned = state.data.boardPosts.find((p) => p.pinned) || state.data.boardPosts[0] || {
    title: "공지 없음",
    body: "등록된 공지가 아직 없어요.",
  };

  screens.home.innerHTML = `
    <article class="card">
      <div class="preview-label">다음 수업</div>
      <div class="preview-main">${escapeHtml(firstLesson.period)} ${escapeHtml(firstLesson.subject)}</div>
      <div class="lesson-meta">🕒 ${escapeHtml(firstLesson.time)} · 👩‍🏫 ${escapeHtml(firstLesson.teacher)}</div>
    </article>

    <article class="card">
      <div class="preview-label">오늘 급식</div>
      <div class="preview-main">${meal.menu.length ? meal.menu.map(escapeHtml).join(", ") : "데이터 없음"}</div>
      <div class="lesson-meta">🔥 ${meal.kcal}kcal · ⚠️ 알레르기 ${escapeHtml(meal.allergy)}</div>
      <div class="lesson-meta">⭐ 평균 ${avg(meal.ratings).toFixed(1)} / 5 (${meal.ratings.length}명)</div>
    </article>

    <article class="card">
      <div class="preview-label">공지 미리보기</div>
      <div class="preview-main">${escapeHtml(pinned.title)}</div>
      <div class="lesson-meta">${escapeHtml(pinned.body)}</div>
    </article>

    ${isTeacherMode
      ? `<article class="card">
      <div class="preview-label">선생님 모드</div>
      <div class="preview-main">교사용 공지를 빠르게 등록할 수 있어요.</div>
      <div class="lesson-meta">게시판에서 고정 공지 체크 후 등록해 보세요.</div>
    </article>`
      : ""}
  `;
}

function renderTimetable() {
  const day = state.selectedDay;
  void syncTimetableFromApi(day, { silent: true });
  const lessons = state.data.timetable[day] || [];

  screens.timetable.innerHTML = `
    ${renderDayButtons(day, "timetable")}
    <h2 class="panel-title">${day}요일 시간표</h2>
    <ul class="lesson-list">
      ${lessons.length
        ? lessons
        .map(
          (lesson, index) => `
        <li class="lesson-item">
          <button class="lesson-head" data-index="${index}" aria-expanded="false">
            <span class="period">${escapeHtml(lesson.period)}</span>
            <div class="lesson-main">
              <p class="lesson-subject">${escapeHtml(lesson.subject)}</p>
              <p class="lesson-meta">🕒 ${escapeHtml(lesson.time)} · 👩‍🏫 ${escapeHtml(lesson.teacher)}</p>
            </div>
            <span class="chevron">▾</span>
          </button>
          <div class="lesson-detail" hidden>
            <p class="detail-title">수업 내용</p>
            <p class="detail-content">${escapeHtml(lesson.content)}</p>
            <p class="detail-title">준비물</p>
            <p class="detail-content">${lesson.materials.map(escapeHtml).join(", ")}</p>
            <p class="detail-title">질문 댓글</p>
            <ul class="comment-list">
              ${lesson.comments.length ? lesson.comments.map((c) => `<li class="comment-item"><div class="comment-author">${escapeHtml(c.author)}</div><div>${escapeHtml(c.text)}</div></li>`).join("") : '<li class="empty">아직 질문이 없어요.</li>'}
            </ul>
            <form class="comment-form" data-kind="lesson" data-day="${day}" data-index="${index}">
              <input class="comment-input" name="text" maxlength="120" placeholder="질문을 입력하세요" required />
              <button class="comment-submit" type="submit">등록</button>
            </form>
          </div>
        </li>`
        )
        .join("")
        : '<li class="empty">시간표 데이터가 없어요.</li>'}
    </ul>
  `;

  bindTimetableEvents();
}

function bindTimetableEvents() {
  screens.timetable.querySelectorAll(".lesson-head").forEach((head) => {
    head.addEventListener("click", () => {
      const detail = head.nextElementSibling;
      const isOpen = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!isOpen));
      detail.hidden = isOpen;
      head.querySelector(".chevron").textContent = isOpen ? "▾" : "▴";
    });
  });

  screens.timetable.querySelectorAll(".comment-form[data-kind='lesson']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = normalizeText(new FormData(form).get("text"), 120);
      if (!text) {
        showToast("질문 내용을 입력해 주세요");
        return;
      }
      const day = form.dataset.day;
      const index = Number(form.dataset.index);
      if (!state.data.timetable[day] || !state.data.timetable[day][index]) {
        showToast("데이터 형식 오류: 다시 시도해 주세요");
        return;
      }
      state.data.timetable[day][index].comments.push({ author: "나", text });
      persistData();
      renderTimetable();
      showToast("질문 등록 완료");
    });
  });
}

function renderMeal() {
  const day = state.selectedDay;
  void syncMealFromApi(day, { silent: true });
  const meal = state.data.meals[day] || { menu: [], kcal: 0, allergy: "-", ratings: [], reviews: [] };

  screens.meal.innerHTML = `
    ${renderDayButtons(day, "meal")}
    <h2 class="panel-title">${day}요일 급식</h2>
    <div class="meal-meta">
      <span class="meta-badge">🔥 ${meal.kcal}kcal</span>
      <span class="meta-badge">⚠️ 알레르기 ${escapeHtml(meal.allergy)}</span>
      <span class="meta-badge">⭐ ${avg(meal.ratings).toFixed(1)} / 5</span>
    </div>
    <ul class="menu-list">
      ${meal.menu.length
        ? meal.menu.map((item) => `<li class="menu-item">${escapeHtml(item)}</li>`).join("")
        : '<li class="empty">급식 데이터가 없어요.</li>'}
    </ul>

    <article class="card">
      <h3>별점 남기기</h3>
      <div class="rating-row">
        ${[1, 2, 3, 4, 5]
          .map((score) => `<button class="score-btn" data-score="${score}" data-day="${day}">${score}점</button>`)
          .join("")}
      </div>
    </article>

    <article class="card">
      <h3>한줄평</h3>
      <ul class="comment-list">
        ${meal.reviews.length ? meal.reviews.map((r) => `<li class="comment-item"><div class="comment-author">${escapeHtml(r.author)}</div><div>${escapeHtml(r.text)}</div></li>`).join("") : '<li class="empty">아직 한줄평이 없어요.</li>'}
      </ul>
      <form class="comment-form" data-kind="meal-review" data-day="${day}">
        <input class="comment-input" name="text" maxlength="120" placeholder="급식 한줄평을 입력하세요" required />
        <button class="comment-submit" type="submit">등록</button>
      </form>
    </article>
  `;

  bindMealEvents();
}

function bindMealEvents() {
  screens.meal.querySelectorAll(".score-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const day = button.dataset.day;
      const score = Number(button.dataset.score);
      if (!state.data.meals[day] || !Number.isInteger(score) || score < 1 || score > 5) {
        showToast("평가 저장 실패: 입력값 오류");
        return;
      }
      state.data.meals[day].ratings.push(score);
      persistData();
      renderMeal();
      showToast("별점 등록 완료");
    });
  });

  screens.meal.querySelectorAll(".comment-form[data-kind='meal-review']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = normalizeText(new FormData(form).get("text"), 120);
      if (!text) {
        showToast("한줄평 내용을 입력해 주세요");
        return;
      }
      const day = form.dataset.day;
      if (!state.data.meals[day]) {
        showToast("데이터 형식 오류: 다시 시도해 주세요");
        return;
      }
      state.data.meals[day].reviews.push({ author: "나", text });
      persistData();
      renderMeal();
      showToast("한줄평 등록 완료");
    });
  });
}

function renderBoard() {
  ensureCurrentClassRoom();
  const isTeacherMode = state.data.profile?.role === "teacher";
  const loggedInTeacher = getLoggedInTeacherAccount();
  const canPinNotice = Boolean(isTeacherMode && loggedInTeacher);

  const roomOptions = state.data.classRooms || [];
  const activeRoomId =
    state.data.activeClassRoomId ||
    roomOptions[0]?.id ||
    "";
  const activeRoom = roomOptions.find((room) => room.id === activeRoomId) || null;

  const sortedPosts = [...state.data.boardPosts]
    .filter((post) => (post.roomId || "") === activeRoomId || (!(post.roomId || "") && Boolean(activeRoomId)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const roomSelectHtml = roomOptions.length
    ? `<select id="classRoomSelect" class="profile-select">${roomOptions
      .map(
        (room) =>
          `<option value="${escapeHtml(room.id)}" ${room.id === activeRoomId ? "selected" : ""}>${escapeHtml(room.name)}</option>`
      )
      .join("")}</select>`
    : '<span class="empty">반 방이 아직 없어요.</span>';

  const activeInviteCode = activeRoom ? (activeRoom.inviteCode || roomIdToInviteCode(activeRoom.id)) : "";

  screens.board.innerHTML = `
    <h2 class="panel-title">공지 게시판</h2>

    <article class="card">
      <h3>반 방</h3>
      <div class="room-row">
        ${roomSelectHtml}
        <button id="createClassRoomBtn" class="comment-submit" type="button">내 반 방 만들기</button>
      </div>
      <p class="lesson-meta">현재 방: ${activeRoom ? escapeHtml(activeRoom.name) : "미선택"}</p>
      ${activeRoom ? `
      <div class="invite-code-box">
        <span class="invite-code-label">🔑 초대코드</span>
        <span id="inviteCodeDisplay" class="invite-code-value">${escapeHtml(activeInviteCode)}</span>
        <button id="copyInviteCodeBtn" class="invite-copy-btn" type="button">코드 복사</button>
      </div>
      <div class="invite-link-box">
        <span class="invite-code-label">🔗 초대링크</span>
        <span class="invite-link-value">${escapeHtml(buildInviteLink(activeInviteCode))}</span>
        <button id="copyInviteLinkBtn" class="invite-copy-btn" type="button">링크 복사</button>
      </div>
      <p class="lesson-meta">링크를 친구에게 보내면 클릭 한 번으로 같은 반 방에 들어와요.</p>
      ` : ""}
    </article>

    <article class="card">
      <h3>코드로 반 방 입장</h3>
      <form id="joinRoomForm" class="comment-form">
        <input id="inviteCodeInput" class="comment-input" maxlength="40" placeholder="초대코드 입력 (예: 7240055-1학년3반)" />
        <button class="comment-submit" type="submit">입장</button>
      </form>
    </article>

    <article class="card">
      <h3>게시글 작성</h3>
      <form id="newPostForm" class="post-form" ${activeRoomId ? "" : "hidden"}>
        <input class="comment-input" name="title" maxlength="60" placeholder="제목" required />
        <textarea class="comment-input post-textarea" name="body" maxlength="500" placeholder="내용" required></textarea>
        ${canPinNotice
          ? `<label class="lesson-meta">
          <input id="pinPostInput" type="checkbox" />
          고정 공지로 등록
        </label>`
          : ""}
        <button class="comment-submit" type="submit">게시글 등록</button>
      </form>
      ${activeRoomId ? "" : '<p class="empty">내 정보에서 학교/학년/반을 먼저 입력하면 방을 만들 수 있어요.</p>'}
      ${isTeacherMode
        ? canPinNotice
          ? '<p class="lesson-meta">선생님 로그인 상태라 고정 공지를 등록할 수 있어요.</p>'
          : '<p class="lesson-meta">고정 공지는 선생님 계정으로 로그인하면 활성화돼요.</p>'
        : ""}
    </article>

    <ul class="board-list">
      ${sortedPosts.length
        ? sortedPosts
        .map(
          (post) => `
        <li class="board-item" data-post-id="${post.id}">
          <div class="board-head">
            ${post.pinned ? '<span class="post-pin">고정 공지</span>' : ""}
            <p class="post-title">${escapeHtml(post.title)}</p>
            <p class="post-date">${escapeHtml(post.date)}</p>
            <p class="post-body">${escapeHtml(post.body)}</p>
          </div>
          <div class="board-comments">
            <p class="detail-title">댓글</p>
            <ul class="comment-list">
              ${post.comments.length ? post.comments.map((c) => `<li class="comment-item"><div class="comment-author">${escapeHtml(c.author)}</div><div>${escapeHtml(c.text)}</div></li>`).join("") : '<li class="empty">아직 댓글이 없어요.</li>'}
            </ul>
            <form class="comment-form" data-kind="post" data-post-id="${post.id}">
              <input class="comment-input" name="text" maxlength="120" placeholder="댓글을 입력하세요" required />
              <button class="comment-submit" type="submit">등록</button>
            </form>
          </div>
        </li>`
        )
        .join("")
        : '<li class="empty">등록된 공지가 아직 없어요.</li>'}
    </ul>
  `;

  bindBoardEvents();
}

function bindBoardEvents() {
  const roomSelect = screens.board.querySelector("#classRoomSelect");
  if (roomSelect) {
    roomSelect.addEventListener("change", () => {
      const roomId = normalizeText(roomSelect.value, 60);
      state.data.activeClassRoomId = roomId;
      persistData();
      renderBoard();
    });
  }

  const createClassRoomBtn = screens.board.querySelector("#createClassRoomBtn");
  if (createClassRoomBtn) {
    createClassRoomBtn.addEventListener("click", () => {
      const roomId = ensureCurrentClassRoom();
      if (!roomId) {
        showToast("내 정보에서 학교코드/학년/반을 먼저 입력해 주세요");
        return;
      }

      state.data.activeClassRoomId = roomId;
      persistData();
      renderBoard();
      showToast("내 반 방 준비 완료");
    });
  }

  const copyInviteCodeBtn = screens.board.querySelector("#copyInviteCodeBtn");
  if (copyInviteCodeBtn) {
    copyInviteCodeBtn.addEventListener("click", () => {
      const code = screens.board.querySelector("#inviteCodeDisplay")?.textContent || "";
      if (!code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code)
          .then(() => showToast("초대코드 복사 완료!"))
          .catch(() => fallbackCopyText(code, "초대코드 복사 완료!"));
      } else {
        fallbackCopyText(code, "초대코드 복사 완료!");
      }
    });
  }

  const copyInviteLinkBtn = screens.board.querySelector("#copyInviteLinkBtn");
  if (copyInviteLinkBtn) {
    copyInviteLinkBtn.addEventListener("click", () => {
      const code = screens.board.querySelector("#inviteCodeDisplay")?.textContent || "";
      if (!code) return;
      const link = buildInviteLink(code);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link)
          .then(() => showToast("초대링크 복사 완료!"))
          .catch(() => fallbackCopyText(link, "초대링크 복사 완료!"));
      } else {
        fallbackCopyText(link, "초대링크 복사 완료!");
      }
    });
  }

  const joinRoomForm = screens.board.querySelector("#joinRoomForm");
  if (joinRoomForm) {
    joinRoomForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = normalizeText(
        screens.board.querySelector("#inviteCodeInput")?.value || "",
        60
      ).replace(/\s/g, "");

      if (!code) {
        showToast("초대코드를 입력해 주세요");
        return;
      }

      const roomId = inviteCodeToRoomId(code);
      if (!roomId) {
        showToast("올바른 초대코드가 아니에요. 예: 7240055-1학년3반");
        return;
      }

      const exists = state.data.classRooms.find((room) => room.id === roomId);
      if (!exists) {
        state.data.classRooms.push({
          id: roomId,
          name: getRoomNameFromRoomId(roomId),
          inviteCode: code,
        });
      }

      state.data.activeClassRoomId = roomId;
      persistData();
      renderBoard();
      showToast("반 방 입장 완료!");
    });
  }

  const newPostForm = screens.board.querySelector("#newPostForm");
  if (newPostForm) {
    newPostForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const isTeacherMode = state.data.profile?.role === "teacher";
      const canPinNotice = Boolean(isTeacherMode && getLoggedInTeacherAccount());
      const roomId = normalizeText(state.data.activeClassRoomId || "", 60);
      if (!roomId) {
        showToast("먼저 반 방을 선택해 주세요");
        return;
      }

      const formData = new FormData(newPostForm);
      const title = normalizeText(formData.get("title"), 60);
      const body = normalizeText(formData.get("body"), 500);

      if (!title || !body) {
        showToast("제목과 내용을 모두 입력해 주세요");
        return;
      }

      const nextId =
        state.data.boardPosts.reduce((max, post) => Math.max(max, Number(post.id) || 0), 0) + 1;

      const now = new Date();
      const dateLabel = `${now.getMonth() + 1}/${now.getDate()}`;
      state.data.boardPosts.unshift({
        id: nextId,
        pinned: canPinNotice ? Boolean(newPostForm.querySelector("#pinPostInput")?.checked) : false,
        roomId,
        title,
        date: dateLabel,
        body,
        comments: [],
      });
      persistData();
      renderBoard();
      showToast("게시글 등록 완료");
    });
  }

  screens.board.querySelectorAll(".comment-form[data-kind='post']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = normalizeText(new FormData(form).get("text"), 120);
      if (!text) {
        showToast("댓글 내용을 입력해 주세요");
        return;
      }

      const postId = Number(form.dataset.postId);
      const post = state.data.boardPosts.find((item) => item.id === postId);
      if (!post) {
        showToast("데이터 형식 오류: 다시 시도해 주세요");
        return;
      }

      post.comments.push({ author: "나", text });
      persistData();
      renderBoard();
      showToast("댓글 등록 완료");
    });
  });
}

function renderProfile() {
  const profile = state.data.profile;
  const isTeacherMode = profile.role === "teacher";
  const teacherAccountCount = Number.isFinite(state.teacherAccountCount)
    ? state.teacherAccountCount
    : Array.isArray(state.data.teacherAccounts)
      ? state.data.teacherAccounts.length
      : 0;
  const loggedInTeacher = getLoggedInTeacherAccount();
  const teacherAccountsHtml = Array.isArray(state.data.teacherAccounts) && state.data.teacherAccounts.length
    ? state.data.teacherAccounts
        .map(
          (account) => `
        <li class="comment-item">
          <div class="comment-author">${escapeHtml(account.id)}</div>
          <div>담당: ${escapeHtml(account.subject || "미지정")}</div>
          <form class="comment-form teacher-password-form" data-teacher-id="${escapeHtml(account.id)}">
            <input class="comment-input" name="nextPassword" type="password" maxlength="30" placeholder="새 비밀번호" />
            <input class="comment-input" name="nextPasswordConfirm" type="password" maxlength="30" placeholder="새 비밀번호 확인" />
            <button class="comment-submit" type="submit">비밀번호 변경</button>
          </form>
          <button class="danger-btn teacher-delete-btn" type="button" data-teacher-id="${escapeHtml(account.id)}">계정 삭제</button>
        </li>`
        )
        .join("")
    : '<li class="empty">아직 선생님 계정이 없어요.</li>';
  const searchResultHtml = state.schoolSearchResults.length
    ? `<ul class="school-search-list">${state.schoolSearchResults
      .map(
        (item) => `
      <li>
        <button type="button" class="school-search-item" data-school-id="${escapeHtml(item.id)}">
          <span class="school-search-name">${escapeHtml(item.name)}</span>
          <span class="school-search-meta">${escapeHtml(item.officeCode)} / ${escapeHtml(item.schoolCode)} / ${escapeHtml(item.level)}</span>
        </button>
      </li>`
      )
      .join("")}</ul>`
    : '<p class="empty">학교명을 검색하면 여기서 선택할 수 있어요.</p>';

  const schoolOptionsHtml = state.schoolOptions.length
    ? state.schoolOptions
        .map(
          (item) =>
            `<option value="${escapeHtml(item.id)}" ${profile.schoolId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`
        )
        .join("")
    : '<option value="">학교 목록 없음</option>';

  screens.profile.innerHTML = `
    <h2 class="panel-title">내 정보</h2>
    <form id="profileForm" class="post-form">
      <label class="profile-key" for="profileNameInput">이름</label>
      <input id="profileNameInput" class="comment-input" maxlength="40" value="${escapeHtml(profile.name)}" placeholder="이름" />

      <label class="profile-key" for="profileRoleInput">사용자 유형</label>
      <select id="profileRoleInput" class="profile-select">
        <option value="student" ${profile.role === "student" ? "selected" : ""}>학생</option>
        <option value="teacher" ${profile.role === "teacher" ? "selected" : ""}>선생님</option>
      </select>

      <label class="profile-key" for="teacherSubjectInput">담당 과목 (선택)</label>
      <input id="teacherSubjectInput" class="comment-input" maxlength="30" value="${escapeHtml(profile.teacherSubject || "")}" placeholder="예: 수학" />

      <label class="profile-key" for="schoolSelect">학교</label>
      <select id="schoolSelect" class="profile-select">${schoolOptionsHtml}</select>

      <label class="profile-key" for="schoolSearchInput">학교 검색</label>
      <div class="comment-form">
        <input id="schoolSearchInput" class="comment-input" maxlength="40" value="${escapeHtml(state.schoolSearchQuery || "")}" placeholder="학교 이름 입력" />
        <button id="schoolSearchBtn" class="comment-submit" type="button">검색</button>
      </div>
      ${searchResultHtml}

      <label class="profile-key" for="officeCodeInput">교육청 코드</label>
      <input id="officeCodeInput" class="comment-input" maxlength="10" value="${escapeHtml(profile.officeCode || "")}" placeholder="예: D10" />

      <label class="profile-key" for="schoolCodeInput">학교 코드</label>
      <input id="schoolCodeInput" class="comment-input" maxlength="10" value="${escapeHtml(profile.schoolCode || "")}" placeholder="예: 7240055" />

      <label class="profile-key" for="schoolLevelInput">학교급</label>
      <select id="schoolLevelInput" class="profile-select">
        <option value="els" ${profile.schoolLevel === "els" ? "selected" : ""}>초등 (els)</option>
        <option value="mis" ${profile.schoolLevel === "mis" ? "selected" : ""}>중등 (mis)</option>
        <option value="his" ${profile.schoolLevel === "his" ? "selected" : ""}>고등 (his)</option>
      </select>

      <label class="profile-key" for="gradeInput">학년</label>
      <input id="gradeInput" class="comment-input" maxlength="2" value="${escapeHtml(profile.grade)}" placeholder="예: 1" />

      <label class="profile-key" for="classNoInput">반</label>
      <input id="classNoInput" class="comment-input" maxlength="2" value="${escapeHtml(profile.classNo || "")}" placeholder="예: 3" />

      <button class="comment-submit" type="submit">내 정보 저장</button>
    </form>
    <ul class="profile-list">
      <li class="profile-row"><span class="profile-key">상점</span><span class="profile-value point-merit">+${profile.merit}</span></li>
      <li class="profile-row"><span class="profile-key">벌점</span><span class="profile-value point-penalty">${Number(profile.penalty) > 0 ? `-${profile.penalty}` : "0"}</span></li>
    </ul>
    <button id="resetDataBtn" class="danger-btn">데이터 초기화</button>

    <article class="card">
      <h3>선생님 로그인</h3>
      <form id="teacherLoginForm" class="post-form">
        <input id="teacherLoginIdInput" class="comment-input" maxlength="20" placeholder="선생님 아이디" ${isTeacherMode ? "" : "disabled"} />
        <input id="teacherLoginPwInput" class="comment-input" type="password" maxlength="30" placeholder="비밀번호" ${isTeacherMode ? "" : "disabled"} />
        <button class="comment-submit" type="submit" ${isTeacherMode ? "" : "disabled"}>로그인</button>
      </form>
      ${loggedInTeacher
        ? `<p class="lesson-meta">현재 로그인: ${escapeHtml(loggedInTeacher.id)} (${escapeHtml(loggedInTeacher.subject || "과목 미지정")})</p>
        <button id="teacherLogoutBtn" class="danger-btn" type="button">선생님 로그아웃</button>`
        : '<p class="lesson-meta">현재 로그인된 선생님 계정이 없어요.</p>'}
      <form id="teacherRecoverForm" class="post-form">
        <input id="teacherRecoverIdInput" class="comment-input" maxlength="20" placeholder="복구할 선생님 아이디" ${isTeacherMode ? "" : "disabled"} />
        <input id="teacherRecoverCodeInput" class="comment-input" maxlength="40" placeholder="복구코드" ${isTeacherMode ? "" : "disabled"} />
        <input id="teacherRecoverPwInput" class="comment-input" type="password" maxlength="30" placeholder="새 비밀번호" ${isTeacherMode ? "" : "disabled"} />
        <button class="comment-submit" type="submit" ${isTeacherMode ? "" : "disabled"}>잠금 해제/비번 초기화</button>
      </form>
      ${isTeacherMode ? "" : '<p class="empty">사용자 유형을 선생님으로 바꾸면 사용할 수 있어요.</p>'}
    </article>

    <article class="card">
      <h3>선생님 계정 만들기</h3>
      <form id="teacherSignupForm" class="post-form">
        <input id="teacherAccountIdInput" class="comment-input" maxlength="20" placeholder="선생님 아이디 (4~20자)" ${isTeacherMode ? "" : "disabled"} />
        <input id="teacherAccountPwInput" class="comment-input" type="password" maxlength="30" placeholder="비밀번호 (8자 이상, 영문+숫자)" ${isTeacherMode ? "" : "disabled"} />
        <input id="teacherAccountPwConfirmInput" class="comment-input" type="password" maxlength="30" placeholder="비밀번호 확인" ${isTeacherMode ? "" : "disabled"} />
        <button class="comment-submit" type="submit" ${isTeacherMode ? "" : "disabled"}>계정 만들기</button>
      </form>
      <p class="lesson-meta">등록된 선생님 계정 수: ${teacherAccountCount}</p>
      <p class="lesson-meta">이 계정 정보는 서버에 저장되고, 로그인 상태는 새로고침 시 다시 로그인해야 해요.</p>
      ${isTeacherMode ? "" : '<p class="empty">사용자 유형을 선생님으로 바꾸면 사용할 수 있어요.</p>'}
    </article>

    <article class="card">
      <h3>선생님 계정 관리</h3>
      <p class="lesson-meta">비밀번호 변경/삭제는 로그인한 본인 계정만 가능해요.</p>
      <ul class="comment-list">
        ${teacherAccountsHtml}
      </ul>
    </article>
  `;

  const resetBtn = screens.profile.querySelector("#resetDataBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetAllData);
  }

  const schoolSelect = screens.profile.querySelector("#schoolSelect");
  if (schoolSelect) {
    schoolSelect.addEventListener("change", () => {
      const selectedId = normalizeText(schoolSelect.value, 40);
      const selected = state.schoolOptions.find((item) => item.id === selectedId);
      state.data.profile.schoolId = selectedId;
      state.data.profile.school = selected ? selected.name : "";
      if (selected) {
        state.data.profile.officeCode = selected.officeCode || state.data.profile.officeCode;
        state.data.profile.schoolCode = selected.schoolCode || state.data.profile.schoolCode;
        state.data.profile.schoolLevel = selected.level || state.data.profile.schoolLevel;
        state.data.profile.grade = selected.grade || state.data.profile.grade;
        state.data.profile.classNo = selected.classNo || state.data.profile.classNo;
      }

      persistData();
      renderProfile();
    });
  }

  const schoolSearchBtn = screens.profile.querySelector("#schoolSearchBtn");
  if (schoolSearchBtn) {
    schoolSearchBtn.addEventListener("click", () => {
      const q = screens.profile.querySelector("#schoolSearchInput")?.value || "";
      void searchSchoolsByName(q);
    });
  }

  const schoolSearchInput = screens.profile.querySelector("#schoolSearchInput");
  if (schoolSearchInput) {
    schoolSearchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void searchSchoolsByName(schoolSearchInput.value || "");
    });
  }

  screens.profile.querySelectorAll(".school-search-item").forEach((button) => {
    button.addEventListener("click", () => {
      const schoolId = normalizeText(button.getAttribute("data-school-id") || "", 60);
      const picked = state.schoolSearchResults.find((item) => item.id === schoolId);
      if (!picked) return;

      if (!state.schoolOptions.find((item) => item.id === picked.id)) {
        state.schoolOptions.unshift({
          id: picked.id,
          name: picked.name,
          officeCode: picked.officeCode,
          schoolCode: picked.schoolCode,
          level: picked.level,
          grade: state.data.profile.grade || "1",
          classNo: state.data.profile.classNo || "1",
        });
      }

      state.data.profile.schoolId = picked.id;
      state.data.profile.school = picked.name;
      state.data.profile.officeCode = picked.officeCode;
      state.data.profile.schoolCode = picked.schoolCode;
      state.data.profile.schoolLevel = picked.level;
      state.mealApiSyncByDay = {};
      state.timetableApiSyncByDay = {};

      persistData();
      renderProfile();
      showToast("학교를 선택했어요. 내 정보 저장을 눌러 반영해 주세요");
    });
  });

  const profileForm = screens.profile.querySelector("#profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const rawOfficeCode = screens.profile.querySelector("#officeCodeInput")?.value || "";
      const rawSchoolCode = screens.profile.querySelector("#schoolCodeInput")?.value || "";
      const cleanedOfficeCode = normalizeOfficeCodeInput(rawOfficeCode);
      const cleanedSchoolCode = normalizeSchoolCodeInput(rawSchoolCode);
      let codeAdjusted = false;

      const next = {
        name: normalizeText(screens.profile.querySelector("#profileNameInput")?.value || "", 40),
        role: normalizeText(screens.profile.querySelector("#profileRoleInput")?.value || "student", 20),
        teacherSubject: normalizeText(screens.profile.querySelector("#teacherSubjectInput")?.value || "", 30),
        officeCode: cleanedOfficeCode,
        schoolCode: cleanedSchoolCode,
        schoolLevel: normalizeText(
          String(screens.profile.querySelector("#schoolLevelInput")?.value || "mis").toLowerCase(),
          10
        ),
        grade: normalizeText(screens.profile.querySelector("#gradeInput")?.value || "", 2),
        classNo: normalizeText(screens.profile.querySelector("#classNoInput")?.value || "", 2),
      };

      if (rawOfficeCode && !next.officeCode) {
        codeAdjusted = true;
      }

      if (rawSchoolCode && !next.schoolCode) {
        codeAdjusted = true;
      }

      if (next.officeCode && !/^[A-Z0-9]{2,10}$/.test(next.officeCode)) {
        next.officeCode = "";
        codeAdjusted = true;
      }

      if (next.schoolCode && !/^\d{5,10}$/.test(next.schoolCode)) {
        next.schoolCode = "";
        codeAdjusted = true;
      }

      if (next.grade && !/^\d{1,2}$/.test(next.grade)) {
        showToast("학년은 숫자로 입력해 주세요");
        return;
      }

      if (next.classNo && !/^\d{1,2}$/.test(next.classNo)) {
        showToast("반은 숫자로 입력해 주세요");
        return;
      }

      state.data.profile.name = next.name;
      state.data.profile.role = ["student", "teacher"].includes(next.role) ? next.role : "student";
      state.data.profile.teacherSubject = next.teacherSubject;

      if (state.data.profile.role !== "teacher" && state.data.teacherSession) {
        clearTeacherSession();
      }

      state.data.profile.officeCode = next.officeCode;
      state.data.profile.schoolCode = next.schoolCode;
      state.data.profile.schoolLevel = ["els", "mis", "his"].includes(next.schoolLevel)
        ? next.schoolLevel
        : "mis";
      state.data.profile.grade = next.grade || "1";
      state.data.profile.classNo = next.classNo || "1";

      state.mealApiSyncByDay = {};
      state.timetableApiSyncByDay = {};
      state.data.meals = deepCopy(DEFAULT_DATA.meals);
      state.data.timetable = deepCopy(DEFAULT_DATA.timetable);

      ensureCurrentClassRoom();

      persistData();
      showToast(codeAdjusted ? "코드 형식이 맞지 않아 비우고 저장했어요" : "내 정보 저장 완료");

      if (state.activeTab === "home") renderHome();
      if (state.activeTab === "meal") renderMeal();
      if (state.activeTab === "timetable") renderTimetable();
      if (state.activeTab === "board") renderBoard();
    });
  }

  const teacherSignupForm = screens.profile.querySelector("#teacherSignupForm");
  if (teacherSignupForm) {
    teacherSignupForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (state.data.profile?.role !== "teacher") {
        showToast("선생님 유형에서만 계정을 만들 수 있어요");
        return;
      }

      const rawId = screens.profile.querySelector("#teacherAccountIdInput")?.value || "";
      const rawPw = screens.profile.querySelector("#teacherAccountPwInput")?.value || "";
      const rawPwConfirm = screens.profile.querySelector("#teacherAccountPwConfirmInput")?.value || "";

      const teacherId = normalizeTeacherAccountId(rawId);
      const password = String(rawPw || "");
      const passwordConfirm = String(rawPwConfirm || "");

      if (!/^[a-z0-9._-]{4,20}$/.test(teacherId)) {
        showToast("아이디는 영문 소문자/숫자 4~20자로 입력해 주세요");
        return;
      }

      if (!/^(?=.*[A-Za-z])(?=.*\d).{8,30}$/.test(password)) {
        showToast("비밀번호는 8자 이상, 영문+숫자를 포함해 주세요");
        return;
      }

      if (password !== passwordConfirm) {
        showToast("비밀번호 확인이 일치하지 않아요");
        return;
      }

      if (!Array.isArray(state.data.teacherAccounts)) {
        state.data.teacherAccounts = [];
      }

      if (state.data.teacherAccounts.some((item) => item.id === teacherId)) {
        showToast("이미 존재하는 선생님 아이디예요");
        return;
      }

      const registerRes = await requestJson("/api/teacher-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: teacherId,
          name: normalizeText(state.data.profile?.name || "선생님", 40) || "선생님",
          subject: normalizeText(state.data.profile?.teacherSubject || "", 30),
          password,
        }),
      });

      if (!registerRes.ok || registerRes.payload?.ok === false) {
        showToast(registerRes.payload?.message || "선생님 계정 생성 실패");
        return;
      }

      await loadTeacherAccountsFromServer();
      persistData();
      renderProfile();
      showToast("선생님 계정 생성 완료");
    });
  }

  const teacherLoginForm = screens.profile.querySelector("#teacherLoginForm");
  if (teacherLoginForm) {
    teacherLoginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (state.data.profile?.role !== "teacher") {
        showToast("선생님 유형에서만 로그인할 수 있어요");
        return;
      }

      const teacherId = normalizeTeacherAccountId(
        screens.profile.querySelector("#teacherLoginIdInput")?.value || ""
      );
      const password = String(screens.profile.querySelector("#teacherLoginPwInput")?.value || "");

      if (!teacherId || !password) {
        showToast("아이디와 비밀번호를 입력해 주세요");
        return;
      }

      const loginRes = await requestJson("/api/teacher-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teacherId, password }),
      });

      if (!loginRes.ok || loginRes.payload?.ok === false) {
        showToast(loginRes.payload?.message || "로그인 실패");
        return;
      }

      if (!state.data.teacherSession || typeof state.data.teacherSession !== "object") {
        state.data.teacherSession = { loggedInId: "", token: "" };
      }
      state.data.teacherSession.loggedInId = teacherId;
      state.data.teacherSession.token = normalizeText(loginRes.payload?.token || "", 120);
      await loadTeacherAccountsFromServer();
      persistData();
      renderProfile();
      showToast("선생님 로그인 완료");
    });
  }

  const teacherLogoutBtn = screens.profile.querySelector("#teacherLogoutBtn");
  if (teacherLogoutBtn) {
    teacherLogoutBtn.addEventListener("click", () => {
      clearTeacherSession();
      persistData();
      renderProfile();
      showToast("선생님 로그아웃 완료");
    });
  }

  screens.profile.querySelectorAll(".teacher-password-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const teacherId = normalizeTeacherAccountId(form.getAttribute("data-teacher-id") || "");
      const loggedInId = getTeacherSessionId();
      if (!teacherId || !loggedInId || teacherId !== loggedInId) {
        showToast("로그인한 본인 계정만 변경할 수 있어요");
        return;
      }

      const nextPassword = String(new FormData(form).get("nextPassword") || "");
      const nextPasswordConfirm = String(new FormData(form).get("nextPasswordConfirm") || "");

      if (!/^(?=.*[A-Za-z])(?=.*\d).{8,30}$/.test(nextPassword)) {
        showToast("새 비밀번호는 8자 이상, 영문+숫자를 포함해 주세요");
        return;
      }

      if (nextPassword !== nextPasswordConfirm) {
        showToast("새 비밀번호 확인이 일치하지 않아요");
        return;
      }

      const account = state.data.teacherAccounts.find((item) => item.id === teacherId);
      if (!account) {
        showToast("계정을 찾을 수 없어요");
        return;
      }

      const changeRes = await requestJson("/api/teacher-auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: teacherId,
          token: getTeacherSessionToken(),
          newPassword: nextPassword,
        }),
      });

      if (!changeRes.ok || changeRes.payload?.ok === false) {
        showToast(changeRes.payload?.message || "비밀번호 변경 실패");
        return;
      }

      await loadTeacherAccountsFromServer();
      persistData();
      renderProfile();
      showToast("비밀번호 변경 완료");
    });
  });

  screens.profile.querySelectorAll(".teacher-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const teacherId = normalizeTeacherAccountId(button.getAttribute("data-teacher-id") || "");
      const loggedInId = getTeacherSessionId();

      if (!teacherId || !loggedInId || teacherId !== loggedInId) {
        showToast("로그인한 본인 계정만 삭제할 수 있어요");
        return;
      }

      const password = prompt("계정 삭제 확인용 비밀번호를 입력해 주세요") || "";
      if (!password) {
        showToast("비밀번호 입력이 필요해요");
        return;
      }

      const deleteRes = await requestJson("/api/teacher-auth/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: teacherId,
          token: getTeacherSessionToken(),
          password,
        }),
      });

      if (!deleteRes.ok || deleteRes.payload?.ok === false) {
        showToast(deleteRes.payload?.message || "계정 삭제 실패");
        return;
      }

      await loadTeacherAccountsFromServer();
      clearTeacherSession();
      persistData();
      renderProfile();
      showToast("선생님 계정 삭제 완료");
    });
  });

  const teacherRecoverForm = screens.profile.querySelector("#teacherRecoverForm");
  if (teacherRecoverForm) {
    teacherRecoverForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (state.data.profile?.role !== "teacher") {
        showToast("선생님 유형에서만 복구할 수 있어요");
        return;
      }

      const teacherId = normalizeTeacherAccountId(
        screens.profile.querySelector("#teacherRecoverIdInput")?.value || ""
      );
      const recoveryCode = String(screens.profile.querySelector("#teacherRecoverCodeInput")?.value || "");
      const newPassword = String(screens.profile.querySelector("#teacherRecoverPwInput")?.value || "");

      if (!teacherId || !recoveryCode || !newPassword) {
        showToast("복구 아이디/코드/새 비밀번호를 입력해 주세요");
        return;
      }

      const recoverRes = await requestJson("/api/teacher-auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: teacherId,
          recoveryCode,
          newPassword,
        }),
      });

      if (!recoverRes.ok || recoverRes.payload?.ok === false) {
        showToast(recoverRes.payload?.message || "복구 실패");
        return;
      }

      await loadTeacherAccountsFromServer();
      clearTeacherSession();
      persistData();
      renderProfile();
      showToast("잠금 해제/비밀번호 초기화 완료");
    });
  }
}

function resetAllData() {
  state.data = deepCopy(DEFAULT_DATA);
  state.selectedDay = currentSchoolDay();
  persistData();
  switchTab("home");
  showToast("초기화 완료");
}

function switchTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", active);
  });

  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("hidden", key !== tab);
  });

  const map = {
    home: { title: "🏠 홈", desc: "오늘 필요한 정보를 빠르게 확인하세요." },
    timetable: { title: "📅 시간표", desc: "수업 상세와 질문 댓글을 확인해요." },
    meal: { title: "🍱 급식", desc: "요일별 메뉴와 급식 정보를 봐요." },
    board: { title: "💬 게시판", desc: "반 방에서 같은 반 친구들과 글을 봐요." },
    profile: { title: "👤 내 정보", desc: "이름, 학교, 학년과 점수를 확인해요." },
  };

  headerTitle.textContent = map[tab].title;
  headerDesc.textContent = map[tab].desc;

  if (tab === "home") renderHome();
  if (tab === "timetable") renderTimetable();
  if (tab === "meal") renderMeal();
  if (tab === "board") renderBoard();
  if (tab === "profile") renderProfile();
}

function fallbackCopyText(text, successMsg = "복사 완료!") {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    showToast(successMsg);
  } catch (_) {
    showToast(`복사 실패. 직접 선택해 주세요: ${text.slice(0, 40)}`);
  }
}

function bindCommonEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const dayBtn = target.closest(".day-btn");
    if (!dayBtn) return;

    state.selectedDay = dayBtn.dataset.day;
    if (state.activeTab === "timetable") renderTimetable();
    if (state.activeTab === "meal") renderMeal();
    if (state.activeTab === "home") renderHome();
  });
}

function handleJoinRoomFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    const rawCode = params.get("joinRoom");
    if (!rawCode) return;

    const code = normalizeText(String(rawCode).replace(/\s/g, ""), 60);
    const roomId = inviteCodeToRoomId(code);
    if (!roomId) return;

    const exists = state.data.classRooms.find((room) => room.id === roomId);
    if (!exists) {
      state.data.classRooms.push({
        id: roomId,
        name: getRoomNameFromRoomId(roomId),
        inviteCode: code,
      });
    }

    state.data.activeClassRoomId = roomId;
    persistData();

    // URL에서 파라미터 제거 (새로고침 시 재입장 방지)
    const cleanUrl = location.pathname;
    history.replaceState(null, "", cleanUrl);

    showToast(`반 방 자동 입장: ${getRoomNameFromRoomId(roomId)}`);
  } catch (_) {
    // URL 처리 실패는 조용히 무시
  }
}

async function initApp() {
  state.data = safeLoadData();
  await loadTeacherAccountsFromServer();
  await loadSchoolOptions();
  handleJoinRoomFromUrl();
  persistData();
  bindCommonEvents();
  switchTab("home");
}

void initApp();
