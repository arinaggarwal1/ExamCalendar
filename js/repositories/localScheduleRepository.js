import {
  COURSES_STORAGE_KEY,
  DEFAULT_SEMESTER_END_DATE,
  DEFAULT_SEMESTER_LABEL,
  DEFAULT_SEMESTER_START_DATE,
  EVENTS_STORAGE_KEY,
  STORAGE_NAMESPACE,
  defaultExamEvents,
} from "../config.js";
import {
  getCourseName,
  getDefaultCourses,
  isValidEvent,
  mergeCoursesWithEvents,
  normalizeCourse,
  normalizeEvent,
  sortCourses,
} from "../utils.js";

const USER_MIGRATION_VERSION = "v2";

function requireUserId(userId) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";

  if (!normalizedUserId) {
    throw new Error("A valid userId is required for schedule operations.");
  }

  return normalizedUserId;
}

function buildEventsKey(userId) {
  return `${STORAGE_NAMESPACE}:${userId}:events`;
}

function buildCoursesKey(userId) {
  return `${STORAGE_NAMESPACE}:${userId}:courses`;
}

function buildMigrationKey(userId) {
  return `${STORAGE_NAMESPACE}:${userId}:migration:${USER_MIGRATION_VERSION}`;
}

function buildPreferencesKey(userId) {
  return `${STORAGE_NAMESPACE}:${userId}:preferences`;
}

function getLegacyMigrationOwnerKey() {
  return `${STORAGE_NAMESPACE}:legacy-migration-owner`;
}

function readJson(storage, key) {
  const value = storage.getItem(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

function normalizeStoredEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) {
    return null;
  }

  const normalizedEvents = rawEvents.map(normalizeEvent).filter(isValidEvent);
  return normalizedEvents.length ? normalizedEvents : null;
}

function normalizeStoredCourses(rawCourses) {
  if (!Array.isArray(rawCourses)) {
    return null;
  }

  const courseMap = new Map();

  rawCourses
    .map(normalizeCourse)
    .filter(Boolean)
    .forEach((course) => {
      courseMap.set(getCourseName(course).toLowerCase(), course);
    });

  const normalizedCourses = sortCourses([...courseMap.values()]);
  return normalizedCourses.length ? normalizedCourses : null;
}

function getDefaultSchedule() {
  const events = defaultExamEvents.map(normalizeEvent).filter(isValidEvent);
  const courses = mergeCoursesWithEvents(getDefaultCourses(), events);
  return {
    events,
    courses,
    preferences: {
      semester: DEFAULT_SEMESTER_LABEL,
      startDate: DEFAULT_SEMESTER_START_DATE,
      endDate: DEFAULT_SEMESTER_END_DATE,
    },
  };
}

function normalizePreferences(rawPreferences = {}) {
  const semester =
    typeof rawPreferences?.semester === "string" && rawPreferences.semester.trim()
      ? rawPreferences.semester.trim()
      : DEFAULT_SEMESTER_LABEL;
  const startDate = normalizeDateValue(rawPreferences?.startDate, DEFAULT_SEMESTER_START_DATE);
  const endDate = normalizeDateValue(rawPreferences?.endDate, DEFAULT_SEMESTER_END_DATE);

  if (startDate && endDate && startDate > endDate) {
    return { semester, startDate: endDate, endDate: startDate };
  }

  return { semester, startDate, endDate };
}

function normalizeDateValue(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function buildInitialSchedule(storage, userId) {
  const namespacedEvents = normalizeStoredEvents(readJson(storage, buildEventsKey(userId)));
  const namespacedCourses = normalizeStoredCourses(readJson(storage, buildCoursesKey(userId)));

  if (namespacedEvents) {
    return {
      events: namespacedEvents,
      courses: mergeCoursesWithEvents(namespacedCourses ?? [], namespacedEvents),
      preferences: normalizePreferences(readJson(storage, buildPreferencesKey(userId))),
      migratedFromLegacy: false,
    };
  }

  const legacyMigrationOwnerKey = getLegacyMigrationOwnerKey();
  const legacyMigrationOwner = storage.getItem(legacyMigrationOwnerKey);
  const legacyEvents = normalizeStoredEvents(readJson(storage, EVENTS_STORAGE_KEY));
  const legacyCourses = normalizeStoredCourses(readJson(storage, COURSES_STORAGE_KEY));

  if (legacyEvents && (!legacyMigrationOwner || legacyMigrationOwner === userId)) {
    return {
      events: legacyEvents,
      courses: mergeCoursesWithEvents(legacyCourses ?? [], legacyEvents),
      preferences: normalizePreferences(readJson(storage, buildPreferencesKey(userId))),
      migratedFromLegacy: true,
    };
  }

  return {
    ...getDefaultSchedule(),
    migratedFromLegacy: false,
  };
}

export function createLocalScheduleRepository({ storage = window.localStorage } = {}) {
  return {
    // TODO: replace localStorage with Firestore-backed persistence.
    async migrateLocalDataIfNeeded(userId) {
      const normalizedUserId = requireUserId(userId);
      const migrationKey = buildMigrationKey(normalizedUserId);

      if (storage.getItem(migrationKey) === "done") {
        return;
      }

      const initialSchedule = buildInitialSchedule(storage, normalizedUserId);
      writeJson(storage, buildEventsKey(normalizedUserId), initialSchedule.events);
      writeJson(storage, buildCoursesKey(normalizedUserId), initialSchedule.courses);
      writeJson(
        storage,
        buildPreferencesKey(normalizedUserId),
        normalizePreferences(initialSchedule.preferences),
      );
      storage.setItem(migrationKey, "done");

      if (initialSchedule.migratedFromLegacy) {
        storage.setItem(getLegacyMigrationOwnerKey(), normalizedUserId);
      }
    },

    // TODO: replace localStorage with Firestore-backed persistence.
    async loadSchedule(userId) {
      const normalizedUserId = requireUserId(userId);
      await this.migrateLocalDataIfNeeded(normalizedUserId);

      const events =
        normalizeStoredEvents(readJson(storage, buildEventsKey(normalizedUserId))) ??
        getDefaultSchedule().events;
      const courses = mergeCoursesWithEvents(
        normalizeStoredCourses(readJson(storage, buildCoursesKey(normalizedUserId))) ?? [],
        events,
      );
      const preferences = normalizePreferences(readJson(storage, buildPreferencesKey(normalizedUserId)));

      return { events, courses, preferences };
    },

    // TODO: replace localStorage with Firestore-backed persistence.
    async saveEvents(userId, events) {
      const normalizedUserId = requireUserId(userId);
      writeJson(
        storage,
        buildEventsKey(normalizedUserId),
        events.map(normalizeEvent).filter(isValidEvent),
      );
    },

    // TODO: replace localStorage with Firestore-backed persistence.
    async saveCourses(userId, courses) {
      const normalizedUserId = requireUserId(userId);
      writeJson(storage, buildCoursesKey(normalizedUserId), normalizeStoredCourses(courses) ?? []);
    },

    async saveSchedule(userId, schedule) {
      const normalizedUserId = requireUserId(userId);
      await this.saveEvents(normalizedUserId, schedule.events);
      await this.saveCourses(normalizedUserId, schedule.courses);
      await this.savePreferences(normalizedUserId, schedule.preferences);
    },

    async savePreferences(userId, preferences) {
      const normalizedUserId = requireUserId(userId);
      writeJson(storage, buildPreferencesKey(normalizedUserId), normalizePreferences(preferences));
    },
  };
}
