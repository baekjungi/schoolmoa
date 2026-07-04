const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createClient } = require("redis");

const ROOT_DIR = __dirname;
const ENV_FILE = path.join(ROOT_DIR, ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out = {};

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) return;

    const key = trimmed.slice(0, equalIndex).trim();
    const rawValue = trimmed.slice(equalIndex + 1).trim();
    const value = rawValue.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    out[key] = value;
  });

  return out;
}

const fileEnv = parseEnvFile(ENV_FILE);

function env(name, fallback = "") {
  if (process.env[name] !== undefined && process.env[name] !== "") return process.env[name];
  if (fileEnv[name] !== undefined && fileEnv[name] !== "") return fileEnv[name];
  return fallback;
}

const config = {
  port: Number(env("PORT", "4173")),
  neisBaseUrl: env("NEIS_BASE_URL", "https://open.neis.go.kr/hub"),
  neisApiKey: env("NEIS_API_KEY", ""),
  officeCode: env("NEIS_OFFICE_CODE", ""),
  schoolCode: env("NEIS_SCHOOL_CODE", ""),
  schoolLevel: env("NEIS_SCHOOL_LEVEL", "mis").toLowerCase(),
  grade: env("NEIS_GRADE", "1"),
  classNo: env("NEIS_CLASS", "1"),
  schoolOptionsJson: env("SCHOOL_OPTIONS_JSON", ""),
  defaultSchoolName: env("DEFAULT_SCHOOL_NAME", "기본 학교"),
  enableHsts: env("ENABLE_HSTS", "false") === "true",
  enableHttpsRedirect: env("ENABLE_HTTPS_REDIRECT", "false") === "true",
  trustProxy: env("TRUST_PROXY", "false") === "true",
  rateLimitWindowMs: Number(env("RATE_LIMIT_WINDOW_MS", String(60 * 1000))),
  rateLimitMax: Number(env("RATE_LIMIT_MAX", "60")),
  redisUrl: env("REDIS_URL", ""),
  logDir: env("LOG_DIR", path.join(ROOT_DIR, "logs")),
  teacherDataFile: env("TEACHER_DATA_FILE", path.join(ROOT_DIR, "data", "teachers.json")),
  teacherRecoveryCode: env("TEACHER_RECOVERY_CODE", ""),
};

const TEACHER_LOCK_THRESHOLD = 5;
const TEACHER_LOCK_MS = 10 * 60 * 1000;
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultTeacherStore() {
  return {
    teachers: [],
    sessions: [],
  };
}

function loadTeacherStore() {
  try {
    if (!fs.existsSync(config.teacherDataFile)) {
      return defaultTeacherStore();
    }
    const raw = fs.readFileSync(config.teacherDataFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultTeacherStore();
    const teachers = Array.isArray(parsed.teachers) ? parsed.teachers : [];
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    return { teachers, sessions };
  } catch (_) {
    return defaultTeacherStore();
  }
}

function saveTeacherStore(store) {
  ensureParentDir(config.teacherDataFile);
  fs.writeFileSync(config.teacherDataFile, JSON.stringify(store, null, 2), "utf8");
}

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function normalizeTeacherId(value) {
  return String(value || "").trim().toLowerCase().slice(0, 20);
}

function sanitizeTeacherPublic(teacher) {
  return {
    id: String(teacher.id || ""),
    name: String(teacher.name || ""),
    subject: String(teacher.subject || ""),
    createdAt: String(teacher.createdAt || ""),
  };
}

function cleanupExpiredSessions(store) {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => Number(session.expiresAt || 0) > now);
}

function verifyTeacherSession(store, teacherId, token) {
  const id = normalizeTeacherId(teacherId);
  const now = Date.now();
  const session = store.sessions.find(
    (item) => item && item.id === id && String(item.token || "") === String(token || "")
  );
  if (!session) return false;
  if (Number(session.expiresAt || 0) <= now) return false;
  return true;
}

function getTeacherSessionFromHeaders(req) {
  const teacherId = normalizeTeacherId(req.headers["x-teacher-id"] || "");
  const token = String(req.headers["x-teacher-token"] || "").trim();
  return { teacherId, token };
}

async function readJsonBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch (_) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", (error) => reject(error));
  });
}

function parseSchoolOptionsFromConfig() {
  if (!config.schoolOptionsJson) {
    return [
      {
        id: "default",
        name: config.defaultSchoolName,
        officeCode: config.officeCode,
        schoolCode: config.schoolCode,
        level: config.schoolLevel,
        grade: config.grade,
        classNo: config.classNo,
      },
    ];
  }

  try {
    const parsed = JSON.parse(config.schoolOptionsJson);
    if (!Array.isArray(parsed)) throw new Error("SCHOOL_OPTIONS_JSON must be array");
    const normalized = parsed
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id || `school-${index + 1}`),
        name: String(item.name || item.schoolName || `학교 ${index + 1}`),
        officeCode: String(item.officeCode || config.officeCode),
        schoolCode: String(item.schoolCode || config.schoolCode),
        level: String(item.level || config.schoolLevel || "mis").toLowerCase(),
        grade: String(item.grade || config.grade || "1"),
        classNo: String(item.classNo || item.class || config.classNo || "1"),
      }))
      .filter((item) => item.id && item.name && item.officeCode && item.schoolCode);

    if (normalized.length) return normalized;
  } catch (error) {
    console.warn("SCHOOL_OPTIONS_JSON 파싱 실패", error);
  }

  return [
    {
      id: "default",
      name: config.defaultSchoolName,
      officeCode: config.officeCode,
      schoolCode: config.schoolCode,
      level: config.schoolLevel,
      grade: config.grade,
      classNo: config.classNo,
    },
  ];
}

const schoolOptions = parseSchoolOptionsFromConfig();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const STATIC_ALLOWLIST = new Set(["index.html", "styles.css", "app.js"]);

const rateLimitStore = new Map();
let redisClient = null;

function ensureLogDir() {
  if (!fs.existsSync(config.logDir)) {
    fs.mkdirSync(config.logDir, { recursive: true });
  }
}

function getLogFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(config.logDir, `security-${day}.log`);
}

function logEvent(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta,
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);

  try {
    ensureLogDir();
    fs.appendFile(getLogFilePath(), `${line}\n`, () => {});
  } catch (error) {
    console.error("log write failed", error);
  }
}

function createErrorId() {
  return `err_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function createRequestId() {
  return `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function applySecurityHeaders(res, isApi = false, isHttps = false) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (config.enableHsts && isHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (isApi) {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    return;
  }

  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return String(req.socket.remoteAddress || "unknown");
}

async function checkRateLimit(req, reqUrl) {
  const key = `${getClientIp(req)}:${reqUrl.pathname}`;
  const now = Date.now();

  if (redisClient && redisClient.isOpen) {
    try {
      const redisKey = `rl:${key}`;
      const count = await redisClient.incr(redisKey);
      if (count === 1) {
        await redisClient.pExpire(redisKey, config.rateLimitWindowMs);
      }

      if (count > config.rateLimitMax) {
        const ttlMs = await redisClient.pTTL(redisKey);
        return {
          limited: true,
          retryAfterSec: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : config.rateLimitWindowMs) / 1000)),
        };
      }

      return { limited: false };
    } catch (error) {
      logEvent("error", "redis_rate_limit_failed", { message: String(error.message || error) });
    }
  }

  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs });
    return { limited: false };
  }

  current.count += 1;
  if (current.count > config.rateLimitMax) {
    return { limited: true, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }

  return { limited: false };
}

function isValidYmd(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const maxDay = new Date(year, month, 0).getDate();
  return day >= 1 && day <= maxDay;
}

function isValidSchoolId(value) {
  return /^[a-zA-Z0-9_-]{1,40}$/.test(value);
}

function isValidOfficeCode(value) {
  return /^[A-Za-z0-9]{2,10}$/.test(String(value || ""));
}

function isValidSchoolCode(value) {
  return /^\d{5,10}$/.test(String(value || ""));
}

function isValidSchoolLevel(value) {
  return ["els", "mis", "his"].includes(String(value || "").toLowerCase());
}

function isValidSmallNumber(value) {
  return /^\d{1,2}$/.test(String(value || ""));
}

function isValidSchoolQuery(value) {
  return /^[\p{L}\p{N}\s().-]{2,40}$/u.test(String(value || "").trim());
}

function levelFromSchoolKind(kindText) {
  const kind = String(kindText || "");
  if (kind.includes("초")) return "els";
  if (kind.includes("고")) return "his";
  return "mis";
}

function parseSchoolSearchResults(payload) {
  if (!payload || !Array.isArray(payload.schoolInfo)) return [];
  const rowsWrap = payload.schoolInfo.find((item) => item && Array.isArray(item.row));
  if (!rowsWrap || !Array.isArray(rowsWrap.row)) return [];

  return rowsWrap.row
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      id: `${String(row.ATPT_OFCDC_SC_CODE || "")}-${String(row.SD_SCHUL_CODE || "")}`,
      name: String(row.SCHUL_NM || "").trim(),
      officeCode: String(row.ATPT_OFCDC_SC_CODE || "").trim(),
      schoolCode: String(row.SD_SCHUL_CODE || "").trim(),
      level: levelFromSchoolKind(row.SCHUL_KND_SC_NM || ""),
    }))
    .filter((item) => item.id && item.name && isValidOfficeCode(item.officeCode) && isValidSchoolCode(item.schoolCode));
}

async function handleSchoolSearchApi(reqUrl, res) {
  if (!config.neisApiKey) {
    sendJson(res, 400, {
      ok: false,
      message: "NEIS API 키가 없어요. .env의 NEIS_API_KEY를 확인해 주세요.",
    });
    return;
  }

  const query = String(reqUrl.searchParams.get("q") || "").trim();
  if (!isValidSchoolQuery(query)) {
    sendJson(res, 400, {
      ok: false,
      message: "학교 검색어는 2~40자로 입력해 주세요.",
    });
    return;
  }

  try {
    const payload = await fetchNeis("schoolInfo", {
      KEY: config.neisApiKey,
      Type: "json",
      pIndex: 1,
      pSize: 30,
      SCHUL_NM: query,
    });

    const schools = parseSchoolSearchResults(payload).slice(0, 20);
    sendJson(res, 200, {
      ok: true,
      schools,
    });
  } catch (error) {
    const errorId = createErrorId();
    logEvent("error", "school_search_api_error", {
      errorId,
      message: String(error.message || error),
      path: reqUrl.pathname,
    });
    sendJson(res, 500, {
      ok: false,
      message: "학교 검색 API 호출 실패",
      errorId,
    });
  }
}

function resolveSchoolFromRequest(reqUrl) {
  const schoolId = reqUrl.searchParams.get("schoolId") || schoolOptions[0].id;
  if (!isValidSchoolId(schoolId)) {
    return { error: "schoolId 형식이 올바르지 않아요." };
  }

  const baseSchool = schoolOptions.find((item) => item.id === schoolId) || schoolOptions[0];
  const resolved = { ...baseSchool };

  const officeCode = reqUrl.searchParams.get("officeCode");
  const schoolCode = reqUrl.searchParams.get("schoolCode");
  const level = reqUrl.searchParams.get("level");
  const grade = reqUrl.searchParams.get("grade");
  const classNo = reqUrl.searchParams.get("classNo");

  if (officeCode) {
    if (!isValidOfficeCode(officeCode)) return { error: "officeCode 형식이 올바르지 않아요." };
    resolved.officeCode = String(officeCode).toUpperCase();
  }

  if (schoolCode) {
    if (!isValidSchoolCode(schoolCode)) return { error: "schoolCode 형식이 올바르지 않아요." };
    resolved.schoolCode = String(schoolCode);
  }

  if (level) {
    if (!isValidSchoolLevel(level)) return { error: "level은 els/mis/his 중 하나여야 해요." };
    resolved.level = String(level).toLowerCase();
  }

  if (grade) {
    if (!isValidSmallNumber(grade)) return { error: "grade 형식이 올바르지 않아요." };
    resolved.grade = String(grade);
  }

  if (classNo) {
    if (!isValidSmallNumber(classNo)) return { error: "classNo 형식이 올바르지 않아요." };
    resolved.classNo = String(classNo);
  }

  if (!resolved.officeCode || !resolved.schoolCode) {
    return { error: "학교 정보가 부족해요. officeCode/schoolCode를 확인해 주세요." };
  }

  return { school: resolved };
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  applySecurityHeaders(res, true, res.locals && res.locals.isHttps);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  applySecurityHeaders(res, false, res.locals && res.locals.isHttps);
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function todayYmd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
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

function requireNeisBaseConfig() {
  return Boolean(config.neisApiKey && config.officeCode && config.schoolCode);
}

function requireSchoolOptionsConfig() {
  return Boolean(config.neisApiKey && schoolOptions.length);
}

function getTimetableEndpointByLevel(level) {
  if (level === "els") return "elsTimetable";
  if (level === "his") return "hisTimetable";
  return "misTimetable";
}

async function fetchNeis(endpoint, params) {
  const requestUrl = new URL(`${config.neisBaseUrl.replace(/\/$/, "")}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      requestUrl.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(requestUrl);
  if (!response.ok) {
    throw new Error(`NEIS HTTP ${response.status}`);
  }

  return response.json();
}

function parseMeal(payload) {
  if (!payload || !Array.isArray(payload.mealServiceDietInfo)) return null;
  const rows = payload.mealServiceDietInfo.find((item) => item && Array.isArray(item.row));
  const row = rows && rows.row && rows.row[0];
  if (!row) return null;

  return {
    menu: stripHtmlAndTrim(row.DDISH_NM)
      .split(/\n/)
      .map((item) => item.replace(/\([^)]*\)/g, "").trim())
      .filter(Boolean),
    kcal: parseKcal(row.CAL_INFO),
    allergy: stripHtmlAndTrim(row.ALLERGY_INFO || "-"),
    date: String(row.MLSV_YMD || ""),
  };
}

function parseTimetable(payload, endpointKey) {
  if (!payload || !Array.isArray(payload[endpointKey])) return [];
  const rows = payload[endpointKey].find((item) => item && Array.isArray(item.row));
  if (!rows || !Array.isArray(rows.row)) return [];

  return rows.row.map((row, index) => {
    const period = String(row.PERIO || `${index + 1}교시`);
    const subject = String(row.ITRT_CNTNT || row.SUBJECT || row.SBJ_NM || "수업");
    const teacher = String(row.TEACHER_NM || row.TCHR_NM || "선생님");
    const periodNum = Number(String(period).replace(/\D/g, ""));
    const hour = Number.isFinite(periodNum) && periodNum > 0 ? 8 + periodNum : null;

    return {
      period,
      time: hour ? `${String(hour).padStart(2, "0")}:00` : "-",
      subject: subject.trim() || "수업",
      teacher: teacher.trim() || "선생님",
      content: `${subject.trim() || "수업"} 수업`,
      materials: [],
    };
  });
}

async function handleMealApi(reqUrl, res) {
  if (!requireSchoolOptionsConfig()) {
    sendJson(res, 400, {
      ok: false,
      message: "NEIS 설정값이 비어 있어요. .env를 확인해 주세요.",
    });
    return;
  }

  const date = reqUrl.searchParams.get("date") || todayYmd();
  const resolved = resolveSchoolFromRequest(reqUrl);

  if (!isValidYmd(date)) {
    sendJson(res, 400, { ok: false, message: "date는 YYYYMMDD 형식이어야 해요." });
    return;
  }

  if (resolved.error) {
    sendJson(res, 400, { ok: false, message: resolved.error });
    return;
  }

  const school = resolved.school;

  try {
    const payload = await fetchNeis("mealServiceDietInfo", {
      KEY: config.neisApiKey,
      Type: "json",
      pIndex: 1,
      pSize: 20,
      ATPT_OFCDC_SC_CODE: school.officeCode,
      SD_SCHUL_CODE: school.schoolCode,
      MLSV_YMD: date,
    });

    const meal = parseMeal(payload);
    if (!meal) {
      sendJson(res, 200, { ok: false, message: "해당 날짜 급식이 없어요.", meal: null });
      return;
    }

    sendJson(res, 200, { ok: true, meal });
  } catch (error) {
    const errorId = createErrorId();
    logEvent("error", "meal_api_error", {
      errorId,
      message: String(error.message || error),
      path: reqUrl.pathname,
    });
    sendJson(res, 500, {
      ok: false,
      message: "급식 API 호출 실패",
      errorId,
    });
  }
}

async function handleTimetableApi(reqUrl, res) {
  if (!requireSchoolOptionsConfig()) {
    sendJson(res, 400, {
      ok: false,
      message: "NEIS 설정값이 비어 있어요. .env를 확인해 주세요.",
    });
    return;
  }

  const date = reqUrl.searchParams.get("date") || todayYmd();
  const resolved = resolveSchoolFromRequest(reqUrl);

  if (!isValidYmd(date)) {
    sendJson(res, 400, { ok: false, message: "date는 YYYYMMDD 형식이어야 해요." });
    return;
  }

  if (resolved.error) {
    sendJson(res, 400, { ok: false, message: resolved.error });
    return;
  }

  const school = resolved.school;
  const endpoint = getTimetableEndpointByLevel(school.level);

  try {
    const payload = await fetchNeis(endpoint, {
      KEY: config.neisApiKey,
      Type: "json",
      pIndex: 1,
      pSize: 100,
      ATPT_OFCDC_SC_CODE: school.officeCode,
      SD_SCHUL_CODE: school.schoolCode,
      ALL_TI_YMD: date,
      GRADE: school.grade,
      CLASS_NM: school.classNo,
    });

    const timetable = parseTimetable(payload, endpoint);
    if (!timetable.length) {
      sendJson(res, 200, { ok: false, message: "해당 날짜 시간표가 없어요.", timetable: [] });
      return;
    }

    sendJson(res, 200, { ok: true, timetable });
  } catch (error) {
    const errorId = createErrorId();
    logEvent("error", "timetable_api_error", {
      errorId,
      message: String(error.message || error),
      path: reqUrl.pathname,
    });
    sendJson(res, 500, {
      ok: false,
      message: "시간표 API 호출 실패",
      errorId,
    });
  }
}

async function handleTeacherAuthApi(req, reqUrl, res) {
  const pathname = reqUrl.pathname;

  if (req.method === "GET" && pathname === "/api/teacher-auth/list") {
    const store = loadTeacherStore();
    cleanupExpiredSessions(store);
    saveTeacherStore(store);
    const { teacherId, token } = getTeacherSessionFromHeaders(req);
    const authenticated = verifyTeacherSession(store, teacherId, token);
    sendJson(res, 200, {
      ok: true,
      count: store.teachers.length,
      accounts: authenticated ? store.teachers.map(sanitizeTeacherPublic) : [],
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "허용되지 않은 메서드입니다." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, message: String(error.message || "요청 형식 오류") });
    return;
  }

  const store = loadTeacherStore();
  cleanupExpiredSessions(store);
  const now = Date.now();

  if (pathname === "/api/teacher-auth/register") {
    const id = normalizeTeacherId(payload.id);
    const name = String(payload.name || "").trim().slice(0, 40);
    const subject = String(payload.subject || "").trim().slice(0, 30);
    const password = String(payload.password || "");

    if (!/^[a-z0-9._-]{4,20}$/.test(id)) {
      sendJson(res, 400, { ok: false, message: "아이디 형식이 올바르지 않아요." });
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,30}$/.test(password)) {
      sendJson(res, 400, { ok: false, message: "비밀번호 형식이 올바르지 않아요." });
      return;
    }
    if (store.teachers.some((teacher) => teacher.id === id)) {
      sendJson(res, 409, { ok: false, message: "이미 존재하는 선생님 아이디예요." });
      return;
    }

    store.teachers.push({
      id,
      name,
      subject,
      passwordHash: hashPassword(password),
      failedAttempts: 0,
      lockedUntil: 0,
      createdAt: new Date().toISOString(),
    });
    saveTeacherStore(store);
    sendJson(res, 200, { ok: true, message: "선생님 계정 생성 완료" });
    return;
  }

  if (pathname === "/api/teacher-auth/login") {
    const id = normalizeTeacherId(payload.id);
    const password = String(payload.password || "");
    const teacher = store.teachers.find((item) => item.id === id);
    if (!teacher) {
      sendJson(res, 404, { ok: false, message: "존재하지 않는 계정이에요." });
      return;
    }

    if (Number(teacher.lockedUntil || 0) > now) {
      const leftSec = Math.ceil((teacher.lockedUntil - now) / 1000);
      sendJson(res, 423, {
        ok: false,
        message: `계정이 잠겼어요. ${leftSec}초 뒤 다시 시도해 주세요.`,
      });
      return;
    }

    if (teacher.passwordHash !== hashPassword(password)) {
      teacher.failedAttempts = Number(teacher.failedAttempts || 0) + 1;
      if (teacher.failedAttempts >= TEACHER_LOCK_THRESHOLD) {
        teacher.lockedUntil = now + TEACHER_LOCK_MS;
        teacher.failedAttempts = 0;
        saveTeacherStore(store);
        sendJson(res, 423, {
          ok: false,
          message: `계정이 잠겼어요. ${Math.ceil(TEACHER_LOCK_MS / 1000)}초 뒤 다시 시도해 주세요.`,
        });
        return;
      }
      saveTeacherStore(store);
      sendJson(res, 401, { ok: false, message: "비밀번호가 올바르지 않아요." });
      return;
    }

    teacher.failedAttempts = 0;
    teacher.lockedUntil = 0;
    const token = createSessionToken();
    store.sessions.push({
      id,
      token,
      expiresAt: now + TEACHER_SESSION_MS,
    });
    saveTeacherStore(store);
    sendJson(res, 200, {
      ok: true,
      token,
      teacher: sanitizeTeacherPublic(teacher),
    });
    return;
  }

  if (pathname === "/api/teacher-auth/change-password") {
    const id = normalizeTeacherId(payload.id);
    const token = String(payload.token || "");
    const newPassword = String(payload.newPassword || "");
    if (!verifyTeacherSession(store, id, token)) {
      sendJson(res, 401, { ok: false, message: "로그인이 필요해요." });
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,30}$/.test(newPassword)) {
      sendJson(res, 400, { ok: false, message: "새 비밀번호 형식이 올바르지 않아요." });
      return;
    }

    const teacher = store.teachers.find((item) => item.id === id);
    if (!teacher) {
      sendJson(res, 404, { ok: false, message: "계정을 찾을 수 없어요." });
      return;
    }
    teacher.passwordHash = hashPassword(newPassword);
    teacher.failedAttempts = 0;
    teacher.lockedUntil = 0;
    saveTeacherStore(store);
    sendJson(res, 200, { ok: true, message: "비밀번호 변경 완료" });
    return;
  }

  if (pathname === "/api/teacher-auth/delete") {
    const id = normalizeTeacherId(payload.id);
    const token = String(payload.token || "");
    const password = String(payload.password || "");
    if (!verifyTeacherSession(store, id, token)) {
      sendJson(res, 401, { ok: false, message: "로그인이 필요해요." });
      return;
    }

    const teacher = store.teachers.find((item) => item.id === id);
    if (!teacher) {
      sendJson(res, 404, { ok: false, message: "계정을 찾을 수 없어요." });
      return;
    }
    if (teacher.passwordHash !== hashPassword(password)) {
      sendJson(res, 401, { ok: false, message: "비밀번호 확인이 필요해요." });
      return;
    }

    store.teachers = store.teachers.filter((item) => item.id !== id);
    store.sessions = store.sessions.filter((session) => session.id !== id);
    saveTeacherStore(store);
    sendJson(res, 200, { ok: true, message: "계정 삭제 완료" });
    return;
  }

  if (pathname === "/api/teacher-auth/recover") {
    const id = normalizeTeacherId(payload.id);
    const recoveryCode = String(payload.recoveryCode || "");
    const newPassword = String(payload.newPassword || "");
    if (!config.teacherRecoveryCode) {
      sendJson(res, 400, { ok: false, message: "복구코드가 서버에 설정되지 않았어요." });
      return;
    }
    if (recoveryCode !== config.teacherRecoveryCode) {
      sendJson(res, 401, { ok: false, message: "복구코드가 올바르지 않아요." });
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,30}$/.test(newPassword)) {
      sendJson(res, 400, { ok: false, message: "새 비밀번호 형식이 올바르지 않아요." });
      return;
    }
    const teacher = store.teachers.find((item) => item.id === id);
    if (!teacher) {
      sendJson(res, 404, { ok: false, message: "계정을 찾을 수 없어요." });
      return;
    }
    teacher.passwordHash = hashPassword(newPassword);
    teacher.failedAttempts = 0;
    teacher.lockedUntil = 0;
    store.sessions = store.sessions.filter((session) => session.id !== id);
    saveTeacherStore(store);
    sendJson(res, 200, { ok: true, message: "계정 잠금 해제 및 비밀번호 초기화 완료" });
    return;
  }

  sendJson(res, 404, { ok: false, message: "지원하지 않는 인증 경로예요." });
}

function serveStatic(reqUrl, res) {
  const decodedPath = decodeURIComponent(reqUrl.pathname || "/");
  const normalizedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  if (!STATIC_ALLOWLIST.has(normalizedPath)) {
    sendText(res, 404, "Not Found");
    return;
  }
  const filePath = path.resolve(ROOT_DIR, normalizedPath);
  const rootWithSep = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : `${ROOT_DIR}${path.sep}`;

  if (path.basename(filePath).startsWith(".")) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!filePath.startsWith(rootWithSep)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      sendText(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    const staticNoStore = ext === ".css" || ext === ".js";
    applySecurityHeaders(res, false, res.locals && res.locals.isHttps);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": ext === ".html" || staticNoStore ? "no-store" : "public, max-age=300",
    });
    res.end(buffer);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestId = createRequestId();
    const isHttps =
      !!req.socket.encrypted ||
      (config.trustProxy && String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https");

    res.locals = { requestId, isHttps };

    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const isTeacherAuthPath = reqUrl.pathname.startsWith("/api/teacher-auth/");

    if (req.method !== "GET" && req.method !== "HEAD" && !(req.method === "POST" && isTeacherAuthPath)) {
      logEvent("info", "method_not_allowed", {
        requestId,
        method: req.method,
        path: req.url,
        ip: getClientIp(req),
      });
      sendJson(res, 405, { ok: false, message: "허용되지 않은 메서드입니다.", requestId });
      return;
    }

    if (config.enableHttpsRedirect && !isHttps && reqUrl.hostname !== "localhost" && reqUrl.hostname !== "127.0.0.1") {
      const redirectUrl = `https://${req.headers.host}${reqUrl.pathname}${reqUrl.search}`;
      res.writeHead(301, { Location: redirectUrl });
      res.end();
      return;
    }

    logEvent("info", "request_in", {
      requestId,
      method: req.method,
      path: reqUrl.pathname,
      ip: getClientIp(req),
    });

    if (reqUrl.pathname.startsWith("/api/")) {
      const limitResult = await checkRateLimit(req, reqUrl);
      if (limitResult.limited) {
        res.setHeader("Retry-After", String(limitResult.retryAfterSec || 60));
        logEvent("info", "rate_limited", {
          requestId,
          path: reqUrl.pathname,
          ip: getClientIp(req),
          retryAfterSec: limitResult.retryAfterSec || 60,
        });
        sendJson(res, 429, {
          ok: false,
          message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
          requestId,
        });
        return;
      }
    }

    if (reqUrl.pathname === "/api/schools") {
      sendJson(res, 200, {
        ok: true,
        schools: schoolOptions.map((item) => ({
          id: item.id,
          name: item.name,
          officeCode: item.officeCode,
          schoolCode: item.schoolCode,
          level: item.level,
          grade: item.grade,
          classNo: item.classNo,
        })),
        requestId,
      });
      return;
    }

    if (reqUrl.pathname === "/api/school-search") {
      await handleSchoolSearchApi(reqUrl, res);
      return;
    }

    if (reqUrl.pathname.startsWith("/api/teacher-auth/")) {
      await handleTeacherAuthApi(req, reqUrl, res);
      return;
    }

    if (reqUrl.pathname === "/api/meal") {
      await handleMealApi(reqUrl, res);
      return;
    }

    if (reqUrl.pathname === "/api/timetable") {
      await handleTimetableApi(reqUrl, res);
      return;
    }

    serveStatic(reqUrl, res);
  } catch (error) {
    const errorId = createErrorId();
    logEvent("error", "server_error", {
      errorId,
      message: String(error.message || error),
    });
    sendJson(res, 500, { ok: false, message: "서버 오류", errorId, requestId: res.locals && res.locals.requestId });
  }
});

async function initializeRedis() {
  if (!config.redisUrl) {
    logEvent("info", "rate_limit_store", { mode: "memory" });
    return;
  }

  try {
    redisClient = createClient({ url: config.redisUrl });
    redisClient.on("error", (error) => {
      logEvent("error", "redis_client_error", { message: String(error.message || error) });
    });
    await redisClient.connect();
    logEvent("info", "rate_limit_store", { mode: "redis" });
  } catch (error) {
    redisClient = null;
    logEvent("error", "redis_connect_failed", { message: String(error.message || error), fallback: "memory" });
  }
}

async function startServer() {
  await initializeRedis();
  server.listen(config.port, () => {
    logEvent("info", "server_started", {
      url: `http://localhost:${config.port}`,
      hsts: config.enableHsts,
      httpsRedirect: config.enableHttpsRedirect,
    });
  });
}

startServer();
