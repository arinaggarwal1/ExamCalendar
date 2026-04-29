import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { DEFAULT_SEMESTER_LABEL, FIREBASE_CONFIG } from "../config.js";
import {
  formatDateValue,
  getCourseName,
  isValidEvent,
  mergeCoursesWithEvents,
  normalizeCourse,
  normalizeEvent,
  normalizeNtfySettings,
  parseLocalDate,
  sortCourses,
} from "../utils.js";

const LEGACY_SCHEDULE_SUBCOLLECTION = "schedule";
const LEGACY_SCHEDULE_DOCUMENT_ID = "main";

function requireUserId(userId) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";

  if (!normalizedUserId) {
    throw new Error("A valid userId is required for schedule operations.");
  }

  return normalizedUserId;
}

function getOrCreateFirebaseApp(firebaseConfig) {
  if (!firebaseConfig?.apiKey) {
    return null;
  }

  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

function normalizeDateValue(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function normalizeStoredDateValue(value, fallback = "") {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    return normalizeDateValue(value, fallback);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateValue(value);
  }

  if (typeof value?.toDate === "function") {
    return formatDateValue(value.toDate());
  }

  return fallback;
}

function toFirestoreDateValue(dateString) {
  const normalizedDate = normalizeDateValue(dateString);
  return normalizedDate ? parseLocalDate(normalizedDate) : null;
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.map(normalizeEvent).filter(isValidEvent);
}

function normalizeCourses(courses) {
  if (!Array.isArray(courses)) {
    return [];
  }

  const courseMap = new Map();

  courses
    .map(normalizeCourse)
    .filter(Boolean)
    .forEach((course) => {
      courseMap.set(getCourseName(course).toLowerCase(), course);
    });

  return sortCourses([...courseMap.values()]);
}

function normalizePreferences(rawPreferences = {}) {
  const semester =
    typeof rawPreferences?.semester === "string" && rawPreferences.semester.trim()
      ? rawPreferences.semester.trim()
      : DEFAULT_SEMESTER_LABEL;
  const startDate = normalizeStoredDateValue(rawPreferences?.startDate);
  const endDate = normalizeStoredDateValue(rawPreferences?.endDate);

  if (startDate && endDate && startDate > endDate) {
    return {
      semester,
      startDate: endDate,
      endDate: startDate,
    };
  }

  return {
    semester,
    startDate,
    endDate,
  };
}

function normalizeSchedule(schedule = {}) {
  const events = normalizeEvents(schedule.events);
  const courses = mergeCoursesWithEvents(normalizeCourses(schedule.courses), events);
  const preferences = normalizePreferences(schedule.preferences);

  return { events, courses, preferences };
}

function normalizeUserSetupState(rawUserDocument = {}) {
  const storedSemesterLabel =
    typeof rawUserDocument?.semesterLabel === "string" ? rawUserDocument.semesterLabel.trim() : "";
  const semesterStart = normalizeStoredDateValue(rawUserDocument?.semesterStart);
  const semesterEnd = normalizeStoredDateValue(rawUserDocument?.semesterEnd);
  const hasCompletedSetup = rawUserDocument?.hasCompletedSetup === true || Boolean(storedSemesterLabel);
  const ntfySettings = normalizeNtfySettings(rawUserDocument?.ntfySettings);

  return {
    hasCompletedSetup,
    semesterLabel: storedSemesterLabel,
    semesterStart,
    semesterEnd,
    ntfySettings,
  };
}

function buildScheduleDocument(schedule) {
  return {
    events: schedule.events,
    courses: schedule.courses,
    preferences: schedule.preferences,
    updatedAt: serverTimestamp(),
  };
}

function buildUserDocument({
  hasCompletedSetup = false,
  semesterLabel = "",
  semesterStart = "",
  semesterEnd = "",
  ntfySettings = null,
}) {
  const document = {
    hasCompletedSetup: Boolean(hasCompletedSetup),
    semesterLabel: typeof semesterLabel === "string" ? semesterLabel.trim() : "",
    semesterStart: toFirestoreDateValue(semesterStart),
    semesterEnd: toFirestoreDateValue(semesterEnd),
    updatedAt: serverTimestamp(),
  };

  if (ntfySettings) {
    document.ntfySettings = normalizeNtfySettings(ntfySettings);
  }

  return document;
}

export function createFirestoreScheduleRepository({ firebaseConfig = FIREBASE_CONFIG } = {}) {
  const firebaseApp = getOrCreateFirebaseApp(firebaseConfig);
  const firestore = firebaseApp ? getFirestore(firebaseApp) : null;

  function requireFirestore() {
    if (!firestore) {
      throw new Error("Firebase is not configured. Add FIREBASE_CONFIG before using Firestore storage.");
    }

    return firestore;
  }

  function getUserDocumentRef(userId) {
    return doc(requireFirestore(), "users", userId);
  }

  function getScheduleDocumentRef(userId) {
    return doc(requireFirestore(), "users", userId, LEGACY_SCHEDULE_SUBCOLLECTION, LEGACY_SCHEDULE_DOCUMENT_ID);
  }

  async function readScheduleFromFirestore(userId) {
    const scheduleSnapshot = await getDoc(getScheduleDocumentRef(userId));

    if (!scheduleSnapshot.exists()) {
      return null;
    }

    return normalizeSchedule(scheduleSnapshot.data());
  }

  async function writeScheduleToFirestore(userId, schedule) {
    const normalizedSchedule = normalizeSchedule(schedule);
    await setDoc(getScheduleDocumentRef(userId), buildScheduleDocument(normalizedSchedule), { merge: true });
    return normalizedSchedule;
  }

  async function promoteLegacyScheduleIntoUserDoc(userId, currentUserState) {
    if (currentUserState.hasCompletedSetup) {
      return currentUserState;
    }

    const legacySchedule = await readScheduleFromFirestore(userId);

    if (!legacySchedule) {
      return currentUserState;
    }

    const promotedState = {
      hasCompletedSetup: true,
      semesterLabel: currentUserState.semesterLabel || legacySchedule.preferences?.semester || DEFAULT_SEMESTER_LABEL,
      semesterStart: currentUserState.semesterStart || legacySchedule.preferences?.startDate || "",
      semesterEnd: currentUserState.semesterEnd || legacySchedule.preferences?.endDate || "",
      ntfySettings: currentUserState.ntfySettings,
    };

    await setDoc(getUserDocumentRef(userId), buildUserDocument(promotedState), { merge: true });
    return promotedState;
  }

  return {
    async createInitialUserDoc(userId, overrides = {}) {
      const normalizedUserId = requireUserId(userId);
      const nextState = {
        hasCompletedSetup: false,
        semesterLabel: "",
        semesterStart: "",
        semesterEnd: "",
        ntfySettings: normalizeNtfySettings(),
        ...overrides,
      };

      await setDoc(
        getUserDocumentRef(normalizedUserId),
        {
          ...buildUserDocument(nextState),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      return normalizeUserSetupState(nextState);
    },

    async checkUserSetupState(userId) {
      const normalizedUserId = requireUserId(userId);
      const userSnapshot = await getDoc(getUserDocumentRef(normalizedUserId));

      if (!userSnapshot.exists()) {
        const legacySchedule = await readScheduleFromFirestore(normalizedUserId);

        if (!legacySchedule) {
          return this.createInitialUserDoc(normalizedUserId);
        }

        return this.createInitialUserDoc(normalizedUserId, {
          hasCompletedSetup: true,
          semesterLabel: legacySchedule.preferences?.semester || DEFAULT_SEMESTER_LABEL,
          semesterStart: legacySchedule.preferences?.startDate || "",
          semesterEnd: legacySchedule.preferences?.endDate || "",
        });
      }

      return promoteLegacyScheduleIntoUserDoc(normalizedUserId, normalizeUserSetupState(userSnapshot.data()));
    },

    async migrateLocalDataIfNeeded(userId) {
      const normalizedUserId = requireUserId(userId);
      const schedule = await readScheduleFromFirestore(normalizedUserId);

      if (schedule) {
        await this.checkUserSetupState(normalizedUserId);
        return;
      }

      await writeScheduleToFirestore(normalizedUserId, {
        events: [],
        courses: [],
        preferences: {},
      });
      await this.checkUserSetupState(normalizedUserId);
    },

    async loadSchedule(userId) {
      const normalizedUserId = requireUserId(userId);
      await this.migrateLocalDataIfNeeded(normalizedUserId);

      const [userSnapshot, schedule] = await Promise.all([
        getDoc(getUserDocumentRef(normalizedUserId)),
        readScheduleFromFirestore(normalizedUserId),
      ]);

      const userPreferences = userSnapshot.exists()
        ? normalizePreferences({
            semester: userSnapshot.data()?.semesterLabel,
            startDate: userSnapshot.data()?.semesterStart,
            endDate: userSnapshot.data()?.semesterEnd,
          })
        : {
            semester: DEFAULT_SEMESTER_LABEL,
            startDate: "",
            endDate: "",
          };

      if (!schedule) {
        return {
          ...normalizeSchedule({
            events: [],
            courses: [],
            preferences: userPreferences,
          }),
          ntfySettings: userSnapshot.exists()
            ? normalizeNtfySettings(userSnapshot.data()?.ntfySettings)
            : normalizeNtfySettings(),
        };
      }

      return {
        ...normalizeSchedule({
          events: schedule.events,
          courses: schedule.courses,
          preferences: userPreferences,
        }),
        ntfySettings: userSnapshot.exists()
          ? normalizeNtfySettings(userSnapshot.data()?.ntfySettings)
          : normalizeNtfySettings(),
      };
    },

    async saveEvents(userId, events) {
      const normalizedUserId = requireUserId(userId);
      const currentSchedule = await this.loadSchedule(normalizedUserId);

      await writeScheduleToFirestore(normalizedUserId, {
        events,
        courses: currentSchedule.courses,
        preferences: currentSchedule.preferences,
      });
    },

    async saveCourses(userId, courses) {
      const normalizedUserId = requireUserId(userId);
      const currentSchedule = await this.loadSchedule(normalizedUserId);

      await writeScheduleToFirestore(normalizedUserId, {
        events: currentSchedule.events,
        courses,
        preferences: currentSchedule.preferences,
      });
    },

    async saveSemesterSettings(
      userId,
      { semesterLabel, semesterStart = "", semesterEnd = "", ntfySettings = null },
      options = {},
    ) {
      const normalizedUserId = requireUserId(userId);
      const existingSetupState = await this.checkUserSetupState(normalizedUserId);
      const nextSetupState = {
        hasCompletedSetup: options.markSetupComplete === true ? true : existingSetupState.hasCompletedSetup,
        semesterLabel: typeof semesterLabel === "string" ? semesterLabel.trim() : "",
        semesterStart: normalizeDateValue(semesterStart),
        semesterEnd: normalizeDateValue(semesterEnd),
        ntfySettings: ntfySettings ? normalizeNtfySettings(ntfySettings) : existingSetupState.ntfySettings,
      };

      await setDoc(getUserDocumentRef(normalizedUserId), buildUserDocument(nextSetupState), { merge: true });
      return nextSetupState;
    },

    async savePreferences(userId, preferences) {
      const normalizedUserId = requireUserId(userId);
      return this.saveSemesterSettings(
        normalizedUserId,
        {
          semesterLabel: preferences?.semester,
          semesterStart: preferences?.startDate,
          semesterEnd: preferences?.endDate,
        },
        { markSetupComplete: false },
      );
    },

    async createCourseFromSetup(userId, course) {
      const normalizedUserId = requireUserId(userId);
      const normalizedCourse = normalizeCourse(course);

      if (!normalizedCourse) {
        return null;
      }

      const currentSchedule = await this.loadSchedule(normalizedUserId);
      const nextCourses = sortCourses([
        ...currentSchedule.courses.filter(
          (existingCourse) => getCourseName(existingCourse).toLowerCase() !== getCourseName(normalizedCourse).toLowerCase(),
        ),
        normalizedCourse,
      ]);

      await writeScheduleToFirestore(normalizedUserId, {
        events: currentSchedule.events,
        courses: nextCourses,
        preferences: currentSchedule.preferences,
      });

      return normalizedCourse;
    },

    async saveSchedule(userId, schedule) {
      const normalizedUserId = requireUserId(userId);
      const normalizedSchedule = normalizeSchedule(schedule);

      await writeScheduleToFirestore(normalizedUserId, normalizedSchedule);
      await this.savePreferences(normalizedUserId, normalizedSchedule.preferences);
      return normalizedSchedule;
    },

    async deleteCollectionRecursive(collectionRef) {
      const snapshot = await getDocs(collectionRef);

      for (const documentSnapshot of snapshot.docs) {
        await deleteDoc(documentSnapshot.ref);
      }
    },

    async deleteUserData(userId) {
      const normalizedUserId = requireUserId(userId);

      await this.deleteCollectionRecursive(
        collection(requireFirestore(), "users", normalizedUserId, LEGACY_SCHEDULE_SUBCOLLECTION),
      );

      await deleteDoc(getUserDocumentRef(normalizedUserId));
    },
  };
}
