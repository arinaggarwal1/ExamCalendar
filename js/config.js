export const EVENTS_STORAGE_KEY = "exam-calendar-events";
export const COURSES_STORAGE_KEY = "exam-calendar-courses";
export const STORAGE_NAMESPACE = "exam-calendar";
export const LOCAL_PREVIEW_USER_ID = "local-preview-user";

export const FIREBASE_CONFIG =
  (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) || {
    apiKey: "AIzaSyAznnVG-8B5wfGdaNKN-DgLMcDI_MeNXQM",
    authDomain: "examcalendar-9e927.firebaseapp.com",
    projectId: "examcalendar-9e927",
    storageBucket: "examcalendar-9e927.firebasestorage.app",
    messagingSenderId: "1085394867406",
    appId: "1:1085394867406:web:1645f0f671455e9707ac9f",
  };

export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const DEFAULT_SEMESTER_LABEL = "Spring 2026";
export const DEFAULT_SEMESTER_START_DATE = "";
export const DEFAULT_SEMESTER_END_DATE = "";
export const SAME_DAY_NOTE = "Multiple events on same day";
export const LEGACY_SAME_DAY_NOTES = new Set([
  "Same day as another exam",
  "Two exams in one day",
  "Same day as paper due",
  "Exam + deadline",
]);

export const defaultExamEvents = [];

export const TYPE_COPY = {
  exam: {
    buttonLabel: "Add exam",
    titlePlaceholder: "Midterm 2",
  },
  deadline: {
    buttonLabel: "Add deadline",
    titlePlaceholder: "Final Paper",
  },
};
