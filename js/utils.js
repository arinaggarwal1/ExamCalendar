import {
  LEGACY_SAME_DAY_NOTES,
  MS_PER_DAY,
  SAME_DAY_NOTE,
  defaultExamEvents,
} from "./config.js";

export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export const COURSE_DAY_OPTIONS = [
  { code: "mon", label: "Mon", dayIndex: 1 },
  { code: "tue", label: "Tue", dayIndex: 2 },
  { code: "wed", label: "Wed", dayIndex: 3 },
  { code: "thu", label: "Thu", dayIndex: 4 },
  { code: "fri", label: "Fri", dayIndex: 5 },
];

const COURSE_DAY_CODE_SET = new Set(COURSE_DAY_OPTIONS.map(({ code }) => code));
const COURSE_DAY_ORDER = new Map(COURSE_DAY_OPTIONS.map(({ code }, index) => [code, index]));
const DAY_INDEX_TO_COURSE_CODE = new Map(COURSE_DAY_OPTIONS.map(({ dayIndex, code }) => [dayIndex, code]));

export function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDefaultCourses() {
  return [...new Set(defaultExamEvents.map(({ course }) => course))].sort();
}

export function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function daysUntil(dateString) {
  const diff = parseLocalDate(dateString) - startOfToday();
  return Math.ceil(diff / MS_PER_DAY);
}

export function formatCountdown(days) {
  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  }

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "1 day left";
  }

  return `${days} days left`;
}

export function truncateText(value, maxLength = 42) {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}...` : value;
}

export function getCountdownTone(days, hasConflict) {
  if (days <= 3) {
    return "urgent";
  }

  if (hasConflict) {
    return "warning";
  }

  return "";
}

function extractMeridiem(value = "") {
  const match = value.match(/\b(AM|PM)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function parseMeridiemTime(value = "") {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return "";
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
    return "";
  }

  if (meridiem === "AM") {
    hours = hours === 12 ? 0 : hours;
  } else {
    hours = hours === 12 ? 12 : hours + 12;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseLegacyTime(type, displayTime = "") {
  if (!displayTime) {
    return { startTime: "", endTime: "" };
  }

  if (type === "deadline") {
    const dueMatch = displayTime.match(/^Due\s+(.+)$/i);

    if (!dueMatch) {
      return { startTime: "", endTime: "" };
    }

    const parsedDue = parseMeridiemTime(dueMatch[1]);
    return { startTime: parsedDue, endTime: parsedDue };
  }

  const parts = displayTime.split(/\s*[-\u2013]\s*/);

  if (parts.length !== 2) {
    return { startTime: "", endTime: "" };
  }

  const rightMeridiem = extractMeridiem(parts[1]);
  const leftValue = extractMeridiem(parts[0]) ? parts[0] : `${parts[0]} ${rightMeridiem}`;

  return {
    startTime: parseMeridiemTime(leftValue),
    endTime: parseMeridiemTime(parts[1]),
  };
}

function normalizeTimeValue(timeValue = "") {
  const normalized = String(timeValue).trim();

  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return "";
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeClockTime(timeValue = "") {
  return normalizeTimeValue(timeValue);
}

export function formatTimeValue(timeValue) {
  const normalized = normalizeTimeValue(timeValue);

  if (!normalized) {
    return "";
  }

  const [hours, minutes] = normalized.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return timeFormatter.format(date);
}

function buildDisplayTime({ type, startTime, endTime }) {
  if (type === "deadline") {
    const formattedDueTime = formatTimeValue(startTime);
    return formattedDueTime ? `Due ${formattedDueTime}` : "";
  }

  const formattedStartTime = formatTimeValue(startTime);
  const formattedEndTime = formatTimeValue(endTime);

  if (!formattedStartTime || !formattedEndTime) {
    return "";
  }

  return `${formattedStartTime}-${formattedEndTime}`;
}

export function buildEventTime({ type, dueTime, startTime, endTime }) {
  if (type === "deadline") {
    const normalizedDueTime = normalizeTimeValue(dueTime);

    return {
      startTime: normalizedDueTime,
      endTime: normalizedDueTime,
      displayTime: buildDisplayTime({
        type,
        startTime: normalizedDueTime,
        endTime: normalizedDueTime,
      }),
    };
  }

  const normalizedStartTime = normalizeTimeValue(startTime);
  const normalizedEndTime = normalizeTimeValue(endTime);

  return {
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
    displayTime: buildDisplayTime({
      type,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
    }),
  };
}

export function normalizeEvent(rawEvent = {}) {
  const normalizedType = rawEvent.type === "deadline" ? "deadline" : "exam";
  const normalizedNotes = typeof rawEvent.notes === "string" ? rawEvent.notes.trim() : "";
  const rawDisplayTime =
    typeof rawEvent.displayTime === "string"
      ? rawEvent.displayTime.trim()
      : typeof rawEvent.time === "string"
        ? rawEvent.time.trim()
        : "";

  const providedStartTime = normalizeTimeValue(rawEvent.startTime);
  const providedEndTime = normalizeTimeValue(rawEvent.endTime);
  const parsedLegacyTimes =
    !providedStartTime || !providedEndTime
      ? parseLegacyTime(normalizedType, rawDisplayTime)
      : { startTime: "", endTime: "" };

  const startTime = providedStartTime || parsedLegacyTimes.startTime;
  const endTime = providedEndTime || parsedLegacyTimes.endTime;
  const computedDisplayTime = buildDisplayTime({
    type: normalizedType,
    startTime,
    endTime,
  });

  return {
    id: typeof rawEvent.id === "string" && rawEvent.id ? rawEvent.id : generateId("evt"),
    type: normalizedType,
    date: typeof rawEvent.date === "string" ? rawEvent.date.trim() : "",
    course: typeof rawEvent.course === "string" ? rawEvent.course.trim() : "",
    event: typeof rawEvent.event === "string" ? rawEvent.event.trim() : "",
    startTime,
    endTime,
    displayTime: rawDisplayTime || computedDisplayTime,
    notes: LEGACY_SAME_DAY_NOTES.has(normalizedNotes) ? SAME_DAY_NOTE : normalizedNotes,
  };
}

function normalizeCourseName(courseName = "") {
  return typeof courseName === "string" ? courseName.trim() : "";
}

function normalizeCourseDays(days = []) {
  if (!Array.isArray(days)) {
    return [];
  }

  const normalizedCodes = days
    .map((day) => (typeof day === "string" ? day.trim().toLowerCase() : ""))
    .filter((day) => COURSE_DAY_CODE_SET.has(day));

  return [...new Set(normalizedCodes)].sort((a, b) => COURSE_DAY_ORDER.get(a) - COURSE_DAY_ORDER.get(b));
}

export function normalizeCourse(rawCourse = {}) {
  const source =
    typeof rawCourse === "string"
      ? { name: rawCourse }
      : rawCourse && typeof rawCourse === "object"
        ? rawCourse
        : {};
  const name = normalizeCourseName(source.name ?? source.course);

  if (!name) {
    return null;
  }

  const classDays = normalizeCourseDays(source.classDays ?? source.days ?? []);
  const startTime = normalizeTimeValue(source.startTime ?? source.classStartTime ?? "");
  const endTime = normalizeTimeValue(source.endTime ?? source.classEndTime ?? "");

  if (startTime && endTime && startTime > endTime) {
    return {
      name,
      classDays,
      startTime: endTime,
      endTime: startTime,
    };
  }

  return {
    name,
    classDays,
    startTime,
    endTime,
  };
}

export function getCourseName(course) {
  if (course && typeof course === "object") {
    return normalizeCourseName(course.name);
  }

  return normalizeCourseName(course);
}

export function sortCourses(courses) {
  return [...courses].sort((a, b) => getCourseName(a).localeCompare(getCourseName(b)));
}

export function courseNameEquals(leftName, rightName) {
  return normalizeCourseName(leftName).toLowerCase() === normalizeCourseName(rightName).toLowerCase();
}

export function getCourseByName(courses, courseName) {
  const normalizedName = normalizeCourseName(courseName).toLowerCase();
  return courses.find((course) => getCourseName(course).toLowerCase() === normalizedName) ?? null;
}

export function courseHasClassSchedule(course) {
  const normalizedCourse = normalizeCourse(course);

  if (!normalizedCourse) {
    return false;
  }

  return Boolean(
    normalizedCourse.classDays.length &&
      normalizedCourse.startTime &&
      normalizedCourse.endTime &&
      normalizedCourse.startTime <= normalizedCourse.endTime,
  );
}

export function getWeekdayCodeFromDate(dateString = "") {
  if (!dateString) {
    return "";
  }

  const localDate = parseLocalDate(dateString);

  if (Number.isNaN(localDate.getTime())) {
    return "";
  }

  return DAY_INDEX_TO_COURSE_CODE.get(localDate.getDay()) ?? "";
}

export function isDateOnCourseDay(dateString, course) {
  const normalizedCourse = normalizeCourse(course);
  const weekdayCode = getWeekdayCodeFromDate(dateString);

  if (!normalizedCourse || !weekdayCode) {
    return false;
  }

  return normalizedCourse.classDays.includes(weekdayCode);
}

export function formatCourseSchedule(course) {
  const normalizedCourse = normalizeCourse(course);

  if (!normalizedCourse || !courseHasClassSchedule(normalizedCourse)) {
    return "No class schedule set";
  }

  const dayLabels = normalizedCourse.classDays
    .map((dayCode) => COURSE_DAY_OPTIONS.find((item) => item.code === dayCode)?.label ?? "")
    .filter(Boolean)
    .join(", ");
  const startLabel = formatTimeValue(normalizedCourse.startTime);
  const endLabel = formatTimeValue(normalizedCourse.endTime);

  return `${dayLabels} • ${startLabel}-${endLabel}`;
}

export function isValidEvent(event) {
  return Boolean(event.date && event.course && event.event && event.displayTime);
}

function getEventSortTime(event) {
  const normalizedStartTime = normalizeTimeValue(event?.startTime);
  const normalizedEndTime = normalizeTimeValue(event?.endTime);
  return normalizedStartTime || normalizedEndTime || "";
}

export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const dateDifference = parseLocalDate(a.date) - parseLocalDate(b.date);

    if (dateDifference !== 0) {
      return dateDifference;
    }

    const timeDifference = getEventSortTime(a).localeCompare(getEventSortTime(b));

    if (timeDifference !== 0) {
      return timeDifference;
    }

    const typeDifference = a.type.localeCompare(b.type);

    if (typeDifference !== 0) {
      return typeDifference;
    }

    const courseDifference = a.course.localeCompare(b.course);

    if (courseDifference !== 0) {
      return courseDifference;
    }

    return a.event.localeCompare(b.event);
  });
}

export function groupEventsByDate(events) {
  return events.reduce((map, event) => {
    if (!map.has(event.date)) {
      map.set(event.date, []);
    }

    map.get(event.date).push(event);
    return map;
  }, new Map());
}

export function mergeCoursesWithEvents(courses, events) {
  const courseMap = new Map();

  courses.map(normalizeCourse).filter(Boolean).forEach((course) => {
    courseMap.set(getCourseName(course).toLowerCase(), course);
  });

  events.forEach((event) => {
    const name = normalizeCourseName(event?.course);

    if (!name) {
      return;
    }

    const key = name.toLowerCase();

    if (!courseMap.has(key)) {
      courseMap.set(key, normalizeCourse({ name }));
    }
  });

  return sortCourses([...courseMap.values()]);
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
