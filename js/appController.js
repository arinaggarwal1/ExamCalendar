import {
  DEFAULT_SEMESTER_END_DATE,
  DEFAULT_SEMESTER_LABEL,
  DEFAULT_SEMESTER_START_DATE,
  NTFY_SCHEDULE_WINDOW_DAYS,
  REMINDER_TIME_OPTIONS,
  TYPE_COPY,
} from "./config.js";
import { renderApp } from "./render.js";
import {
  COURSE_DAY_OPTIONS,
  buildEventTime,
  courseHasClassSchedule,
  courseNameEquals,
  formatDateValue,
  generateNtfyTopic,
  getCourseByName,
  getCourseName,
  getEventDueAt,
  isDateOnCourseDay,
  isEventCompleted,
  isValidEvent,
  normalizeClockTime,
  normalizeCourse,
  normalizeEvent,
  normalizeNtfySettings,
  parseLocalDate,
  sortCourses,
  sortEvents,
  startOfToday,
} from "./utils.js";

const DEADLINE_END_OF_DAY_TIME = "23:59";
const DEADLINE_PRESETS = {
  beforeClass: "before-class",
  afterClass: "after-class",
  endOfDay: "end-of-day",
};
const CLASS_BASED_DEADLINE_PRESETS = new Set([DEADLINE_PRESETS.beforeClass, DEADLINE_PRESETS.afterClass]);

function createDefaultSetupState(overrides = {}) {
  return {
    semesterLabel: "",
    semesterStart: "",
    semesterEnd: "",
    courseName: "",
    courseDays: [],
    courseStartTime: "",
    courseEndTime: "",
    message: "",
    messageTone: "warning",
    isSubmitting: false,
    ...overrides,
  };
}

const DEFAULT_FILTERS = {
  type: "all",
  course: "all",
  status: "all",
};

const STATUS_FILTERS = new Set(["all", "open", "overdue", "completed"]);
const ALL_REMINDER_TIMES = REMINDER_TIME_OPTIONS.map(({ value }) => value);
const NTFY_RECONCILE_THROTTLE_MS = 6 * 60 * 60 * 1000;
const NTFY_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NTFY_REQUEST_MAX_RETRIES = 2;
const NTFY_REQUEST_BACKOFF_MS = 1000;
const NTFY_RECONCILE_CONCURRENCY = 1;
const NTFY_REQUEST_SPACING_MS = 5200;
const NTFY_MIN_FUTURE_MS = 30 * 1000;
const NTFY_DEBUG_QUERY_PARAM = "ntfyDebug";
const NTFY_RATE_LIMIT_DEFAULT_MS = 5 * 60 * 1000;
const NTFY_RATE_LIMIT_MIN_MS = 60 * 1000;
const NTFY_VIEW_CACHE_MS = 30 * 1000;
const NTFY_VIEW_TIMEOUT_MS = 10000;
const ACTIVE_REMINDER_PROVIDER = "pwa";

export function createAppController({ dom, sessionService, scheduleRepository }) {
  const state = {
    authInitialized: false,
    bootstrapStatus: "idle",
    sessionStatus: "loading",
    user: null,
    errorMessage: "",
    events: [],
    courses: [],
    preferences: {
      semester: DEFAULT_SEMESTER_LABEL,
      startDate: DEFAULT_SEMESTER_START_DATE,
      endDate: DEFAULT_SEMESTER_END_DATE,
    },
    ntfySettings: normalizeNtfySettings({
      enabled: true,
      topic: generateNtfyTopic(),
    }),
    filters: { ...DEFAULT_FILTERS },
    setup: createDefaultSetupState(),
  };

  let confirmAction = null;
  let lastFocusedElement = null;
  let activeAuthSequence = 0;
  let editingEventId = null;
  let editingCourseOriginalName = null;
  let isDeletingAccount = false;
  let isAddingEvent = false;
  let isEditingEvent = false;
  let eventPersistenceQueue = Promise.resolve();
  let persistedNtfySettings = normalizeNtfySettings(state.ntfySettings);
  let lastNtfyReconcileAt = 0;
  let ntfyRateLimitedUntil = 0;
  let ntfyScheduledViewCache = null;
  let ntfyOperationQueue = Promise.resolve();
  let ntfyTraceCounter = 0;
  let ntfyScheduleRevision = 0;
  let browserReminderTimers = new Map();
  const ntfyDebugEnabled = isNtfyDebugEnabled();

  function getSelectedType() {
    const selectedInput = dom.eventTypeInputs.find((input) => input.checked);
    return selectedInput ? selectedInput.value : "exam";
  }

  function getSelectedEditType() {
    const selectedInput = dom.editEventTypeInputs.find((input) => input.checked);
    return selectedInput ? selectedInput.value : "exam";
  }

  function setSelectedType(type) {
    dom.eventTypeInputs.forEach((input) => {
      input.checked = input.value === type;
    });
  }

  function setSelectedEditType(type) {
    dom.editEventTypeInputs.forEach((input) => {
      input.checked = input.value === type;
    });
  }

  function setFormMessage(message, tone = "success") {
    dom.formMessage.textContent = message;

    if (message) {
      dom.formMessage.dataset.tone = tone;
    } else {
      delete dom.formMessage.dataset.tone;
    }
  }

  function setCourseMessage(message, tone = "success") {
    dom.courseMessage.textContent = message;

    if (message) {
      dom.courseMessage.dataset.tone = tone;
    } else {
      delete dom.courseMessage.dataset.tone;
    }
  }

  function setAccountSettingsMessage(message, tone = "success") {
    dom.accountSettingsMessage.textContent = message;

    if (message) {
      dom.accountSettingsMessage.dataset.tone = tone;
    } else {
      delete dom.accountSettingsMessage.dataset.tone;
    }
  }

  function setEditFormMessage(message, tone = "success") {
    dom.editFormMessage.textContent = message;

    if (message) {
      dom.editFormMessage.dataset.tone = tone;
    } else {
      delete dom.editFormMessage.dataset.tone;
    }
  }

  function setDeleteAccountMessage(message, tone = "warning") {
    dom.deleteAccountMessage.textContent = message;

    if (message) {
      dom.deleteAccountMessage.dataset.tone = tone;
    } else {
      delete dom.deleteAccountMessage.dataset.tone;
    }
  }

  function setSetupMessage(message, tone = "warning") {
    state.setup = {
      ...state.setup,
      message,
      messageTone: tone,
    };
    render();
  }

  function getCourseNames() {
    return state.courses.map((course) => getCourseName(course)).filter(Boolean);
  }

  function getSelectedReminderTimes(inputs) {
    const selectedTimes = inputs.filter((input) => input.checked).map((input) => Number(input.value));
    return selectedTimes.length ? selectedTimes : [1440, 180, 60];
  }

  function syncReminderTimeInputs(inputs, selectedTimes = []) {
    inputs.forEach((input) => {
      input.checked = selectedTimes.includes(Number(input.value));
    });
  }

  function setNtfyMessage(message, tone = "success") {
    setAccountSettingsMessage(message, tone);
  }

  function isNtfyReminderProviderActive() {
    return ACTIVE_REMINDER_PROVIDER === "ntfy";
  }

  function isBrowserReminderProviderActive() {
    return ACTIVE_REMINDER_PROVIDER === "pwa";
  }

  function isBrowserNotificationSupported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  function getBrowserReminderSettings() {
    const normalizedSettings = normalizeNtfySettings(state.ntfySettings);
    return {
      ...normalizedSettings,
      enabled: true,
      topic: normalizedSettings.topic || "browser-local",
    };
  }

  async function requestBrowserNotificationPermission() {
    if (!isBrowserReminderProviderActive() || !isBrowserNotificationSupported()) {
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission === "denied") {
      return false;
    }

    try {
      return (await Notification.requestPermission()) === "granted";
    } catch (error) {
      console.warn("Could not request browser notification permission", error);
      return false;
    }
  }

  function enqueueNtfyOperation(label, operation) {
    if (!isNtfyReminderProviderActive()) {
      emitNtfyDebugLog("operation_skipped_inactive_provider", { label });
      return Promise.resolve({ scheduled: 0, failed: 0 });
    }

    const queuedOperation = ntfyOperationQueue.catch(() => {}).then(async () => {
      emitNtfyDebugLog("operation_start", { label });

      try {
        const result = await operation();
        emitNtfyDebugLog("operation_done", { label });
        return result;
      } catch (error) {
        emitNtfyDebugLog("operation_error", {
          label,
          message: error?.message || "unknown error",
        });
        throw error;
      }
    });

    ntfyOperationQueue = queuedOperation.catch(() => {});
    return queuedOperation;
  }

  function markNtfyScheduleChanged(reason) {
    ntfyScheduleRevision += 1;
    emitNtfyDebugLog("schedule_revision_changed", {
      reason,
      revision: String(ntfyScheduleRevision),
    });
    return ntfyScheduleRevision;
  }

  function isNtfyScheduleRevisionCurrent(expectedRevision) {
    return !Number.isFinite(expectedRevision) || expectedRevision === ntfyScheduleRevision;
  }

  function formatUnixTimestamp(seconds) {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value <= 0) {
      return "";
    }

    return new Date(value * 1000).toLocaleString();
  }

  function getRateLimitRemainingMs() {
    return Math.max(0, ntfyRateLimitedUntil - Date.now());
  }

  function nextNtfyTraceId(prefix = "trace") {
    ntfyTraceCounter += 1;
    return `${prefix}-${Date.now()}-${ntfyTraceCounter}`;
  }

  function formatRateLimitResumeTime() {
    if (!ntfyRateLimitedUntil) {
      return "";
    }

    return new Date(ntfyRateLimitedUntil).toLocaleTimeString();
  }

  function escapeNtfyDisplay(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getNtfyEntrySequenceId(entry) {
    return typeof entry?.sequence_id === "string" && entry.sequence_id
      ? entry.sequence_id
      : typeof entry?.id === "string"
        ? entry.id
        : "";
  }

  function getNtfyEntryTimeMs(entry) {
    const seconds = Number(entry?.time);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  function getFutureNtfyEntries(entries = [], now = new Date()) {
    const nowMs = now.getTime();
    return entries.filter((entry) => entry?.event === "message" && getNtfyEntryTimeMs(entry) > nowMs);
  }

  function dedupeNtfyEntriesBySequence(entries = []) {
    const bySequence = new Map();
    let duplicateCount = 0;

    for (const entry of entries) {
      const sequenceId = getNtfyEntrySequenceId(entry);
      const key = sequenceId || `${entry?.id || "unknown"}-${entry?.time || ""}-${entry?.message || ""}`;
      const existing = bySequence.get(key);

      if (!existing) {
        bySequence.set(key, entry);
        continue;
      }

      duplicateCount += 1;
      if (getNtfyEntryTimeMs(entry) >= getNtfyEntryTimeMs(existing)) {
        bySequence.set(key, entry);
      }
    }

    return {
      entries: [...bySequence.values()].sort((a, b) => getNtfyEntryTimeMs(a) - getNtfyEntryTimeMs(b)),
      duplicateCount,
    };
  }

  function getExpectedScheduledNtfyEntries(eventsSnapshot = state.events, ntfySettings = state.ntfySettings) {
    const normalizedSettings = normalizeNtfySettings(ntfySettings);
    const now = new Date();

    return eventsSnapshot
      .filter((eventRecord) => !isEventCompleted(eventRecord) && getEventDueAt(eventRecord).getTime() > now.getTime())
      .flatMap((eventRecord) =>
        getSchedulableReminderStages(eventRecord, normalizedSettings, now).map((stage) => ({
          eventId: eventRecord.id,
          sequenceId: getNtfySequenceId(eventRecord, stage.minutesBefore),
          title: eventRecord.event,
          course: eventRecord.course,
          sendAt: stage.sendAt,
          minutesBefore: stage.minutesBefore,
        })),
      );
  }

  function renderScheduledNtfyComparison(entries = [], sourceUrl = "", meta = {}) {
    const actualIds = new Set(entries.map((entry) => getNtfyEntrySequenceId(entry)).filter(Boolean));
    const expectedEntries = getExpectedScheduledNtfyEntries();
    const missingEntries = expectedEntries.filter((entry) => !actualIds.has(entry.sequenceId));
    const actualRows = entries
      .map((entry) => {
        const title = typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : "Reminder";
        const message = typeof entry.message === "string" && entry.message.trim() ? entry.message.trim() : "(No body)";
        const scheduledTime = formatUnixTimestamp(entry.time) || "Unknown time";
        const id = getNtfyEntrySequenceId(entry);

        return `
          <article class="ntfy-scheduled-item">
            <p class="ntfy-scheduled-item-title">${escapeNtfyDisplay(title)}</p>
            <p class="ntfy-scheduled-item-meta">${escapeNtfyDisplay(scheduledTime)}${id ? ` · ${escapeNtfyDisplay(id)}` : ""}</p>
            <p class="ntfy-scheduled-item-body">${escapeNtfyDisplay(message)}</p>
          </article>
        `;
      })
      .join("");
    const missingRows = missingEntries
      .map((entry) => `
        <article class="ntfy-scheduled-item is-missing">
          <p class="ntfy-scheduled-item-title">${escapeNtfyDisplay(`${entry.course} ${entry.title}`.trim())}</p>
          <p class="ntfy-scheduled-item-meta">${escapeNtfyDisplay(entry.sendAt.toLocaleString())} · ${entry.minutesBefore} min before · ${escapeNtfyDisplay(entry.sequenceId)}</p>
          <p class="ntfy-scheduled-item-body">Expected locally, not currently returned by ntfy scheduled view.</p>
        </article>
      `)
      .join("");
    const hiddenBits = [];

    if (meta.hiddenCachedCount) {
      hiddenBits.push(`${meta.hiddenCachedCount} past cached row${meta.hiddenCachedCount === 1 ? "" : "s"} hidden`);
    }

    if (meta.duplicateCount) {
      hiddenBits.push(`${meta.duplicateCount} duplicate future row${meta.duplicateCount === 1 ? "" : "s"} collapsed`);
    }

    const hiddenSummary = hiddenBits.length
      ? `<p class="modal-text">${escapeNtfyDisplay(hiddenBits.join(" · "))}</p>`
      : "";

    dom.ntfyScheduledResults.innerHTML = `
      <div class="ntfy-scheduled-head">
        <p class="modal-text">ntfy: ${entries.length} scheduled · expected: ${expectedEntries.length} · missing: ${missingEntries.length}</p>
        <p class="modal-text">${escapeNtfyDisplay(sourceUrl)}</p>
        ${hiddenSummary}
      </div>
      ${actualRows ? `<div class="ntfy-scheduled-list">${actualRows}</div>` : `<p class="modal-text">No scheduled reminders found in ntfy.</p>`}
      ${missingRows ? `<div class="ntfy-scheduled-list ntfy-missing-list">${missingRows}</div>` : ""}
    `;
  }

  function parseScheduledNtfyPayload(payload = "") {
    const text = typeof payload === "string" ? payload.trim() : "";

    if (!text) {
      return [];
    }

    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed;
        }

        if (parsed && typeof parsed === "object") {
          return [parsed];
        }
      } catch {
        // Fall through to line-delimited parsing.
      }
    }

    return text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return null;
        }

        try {
          return JSON.parse(trimmed);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async function fetchScheduledNtfyEntries(ntfySettings = state.ntfySettings) {
    const normalizedSettings = normalizeNtfySettings(ntfySettings);
    const traceId = nextNtfyTraceId("view");

    if (!normalizedSettings.topic) {
      throw new Error("Notification setup is not ready yet.");
    }

    if (
      ntfyScheduledViewCache &&
      ntfyScheduledViewCache.topic === normalizedSettings.topic &&
      Date.now() - ntfyScheduledViewCache.fetchedAt < NTFY_VIEW_CACHE_MS
    ) {
      emitNtfyDebugLog("view_scheduled_cache_hit", {
        traceId,
        topic: normalizedSettings.topic,
      });
      return ntfyScheduledViewCache.data;
    }

    const sinceSeconds = Math.floor(Date.now() / 1000);
    const endpoint = `${normalizedSettings.serverUrl}/${encodeURIComponent(
      normalizedSettings.topic,
    )}/json?poll=1&sched=1&since=${sinceSeconds}`;
    emitNtfyDebugLog("view_scheduled_start", {
      traceId,
      topic: normalizedSettings.topic,
      endpoint,
    });
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort("scheduled reminder view timed out");
    }, NTFY_VIEW_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        emitNtfyDebugLog("view_scheduled_timeout", {
          traceId,
          endpoint,
          timeoutMs: String(NTFY_VIEW_TIMEOUT_MS),
        });
        throw new Error("Timed out loading scheduled reminders. Try again.");
      }
      emitNtfyDebugLog("view_scheduled_network_error", {
        traceId,
        endpoint,
        message: error?.message || "network error",
      });
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 429) {
        applyRateLimitCooldown(response);
      }
      const body = (await response.text()).trim();
      emitNtfyDebugLog("view_scheduled_fail", {
        traceId,
        endpoint,
        status: String(response.status),
      });
      throw new Error(`Could not load scheduled reminders (${response.status})${body ? `: ${body.slice(0, 160)}` : ""}`);
    }

    const payload = await response.text();
    const allMessageEntries = parseScheduledNtfyPayload(payload).filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      return entry.event === "message";
    });
    const futureEntries = getFutureNtfyEntries(allMessageEntries);
    const { entries, duplicateCount } = dedupeNtfyEntriesBySequence(futureEntries);
    const hiddenCachedCount = Math.max(0, allMessageEntries.length - futureEntries.length);

    const data = {
      endpoint,
      entries,
      duplicateCount,
      hiddenCachedCount,
      rawCount: allMessageEntries.length,
    };
    ntfyScheduledViewCache = {
      topic: normalizedSettings.topic,
      fetchedAt: Date.now(),
      data,
    };
    emitNtfyDebugLog("view_scheduled_done", {
      traceId,
      endpoint,
      entries: String(entries.length),
      hiddenCachedCount: String(hiddenCachedCount),
      duplicateCount: String(duplicateCount),
    });

    return data;
  }

  async function handleViewScheduledNtfy() {
    state.ntfySettings = readAccountNtfySettings();
    if (getRateLimitRemainingMs() > 0) {
      emitNtfyDebugLog("view_scheduled_blocked_rate_limit", {
        retryAt: formatRateLimitResumeTime(),
      });
      setAccountSettingsMessage(`Rate limited by reminders. Try again after ${formatRateLimitResumeTime()}.`, "warning");
      return;
    }

    dom.viewScheduledNtfyButton.disabled = true;
    dom.ntfyScheduledResults.innerHTML = `<p class="modal-text">Loading scheduled reminders...</p>`;

    try {
      const { endpoint, entries, duplicateCount, hiddenCachedCount } = await fetchScheduledNtfyEntries(state.ntfySettings);
      renderScheduledNtfyComparison(entries, endpoint, {
        duplicateCount,
        hiddenCachedCount,
      });
      setAccountSettingsMessage(
        entries.length
          ? `Loaded ${entries.length} future scheduled reminder${entries.length === 1 ? "" : "s"}.`
          : "No future scheduled reminders found.",
      );
    } catch (error) {
      console.error("Failed to load scheduled reminders", error);
      dom.ntfyScheduledResults.innerHTML = `<p class="modal-text">Could not load scheduled reminders.</p>`;
      const rateLimitRemaining = getRateLimitRemainingMs();

      if (rateLimitRemaining > 0) {
        setAccountSettingsMessage(
          `Rate limited by reminders. Try again after ${formatRateLimitResumeTime()}.`,
          "warning",
        );
      } else {
        setAccountSettingsMessage(error?.message || "Could not load scheduled reminders.", "warning");
      }
    } finally {
      dom.viewScheduledNtfyButton.disabled = false;
    }
  }

  function buildNtfySettings(overrides = {}) {
    return normalizeNtfySettings({
      ...state.ntfySettings,
      ...overrides,
    });
  }

  function readAccountNtfySettings() {
    return buildNtfySettings({
      enabled: dom.ntfyEnabledInput.checked,
      topic: dom.ntfyTopicInput.value,
      defaultExamMode: dom.ntfyExamModeSelect.value,
      defaultDeadlineMode: dom.ntfyDeadlineModeSelect.value,
      defaultTimes: getSelectedReminderTimes(dom.ntfyTimeInputs),
    });
  }

  function getSetupNtfyElements() {
    return {
      enabledInput: dom.authScreen.querySelector("#setupNtfyEnabledInput"),
      topicInput: dom.authScreen.querySelector("#setupNtfyTopicInput"),
      examModeSelect: dom.authScreen.querySelector("#setupNtfyExamModeSelect"),
      deadlineModeSelect: dom.authScreen.querySelector("#setupNtfyDeadlineModeSelect"),
      timeInputs: [...dom.authScreen.querySelectorAll('input[name="setup_ntfy_time"]')],
    };
  }

  function readSetupNtfySettings() {
    const elements = getSetupNtfyElements();

    return buildNtfySettings({
      enabled: elements.enabledInput ? elements.enabledInput.checked : true,
      topic: elements.topicInput?.value || state.ntfySettings.topic,
      defaultExamMode: elements.examModeSelect?.value || state.ntfySettings.defaultExamMode,
      defaultDeadlineMode: elements.deadlineModeSelect?.value || state.ntfySettings.defaultDeadlineMode,
      defaultTimes: getSelectedReminderTimes(elements.timeInputs),
    });
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    return false;
  }

  async function copyNtfyTopic(topicInput, setMessage = setNtfyMessage) {
    const topic = topicInput?.value || state.ntfySettings.topic;

    if (!topic) {
      setMessage("Notification setup is not ready yet.", "warning");
      return;
    }

    try {
      const copied = await copyText(topic);

      if (!copied) {
        throw new Error("Clipboard API is unavailable.");
      }

      setMessage("Notification topic copied.");
    } catch (error) {
      console.error("Failed to copy ntfy topic", error);
      if (topicInput) {
        topicInput.focus();
        topicInput.select();
      }
      setMessage("Select and copy the topic manually.", "warning");
    }
  }

  async function sendNtfyTest(settings = state.ntfySettings, setMessage = setNtfyMessage) {
    const normalizedSettings = normalizeNtfySettings(settings);

    if (!normalizedSettings.topic) {
      setMessage("Notification setup is not ready yet.", "warning");
      return;
    }

    setMessage("Sending notification test...");

    try {
      const response = await fetch(
        `${normalizedSettings.serverUrl}/${encodeURIComponent(normalizedSettings.topic)}`,
        {
          method: "POST",
          headers: {
            Title: "Exam Calendar test",
            Priority: "4",
            Tags: "calendar",
          },
          body: "Exam Calendar can send reminders here.",
        },
      );

      if (!response.ok) {
        throw new Error(`ntfy test failed with ${response.status}`);
      }

      setMessage(
        normalizedSettings.enabled
          ? "Test sent. Check your phone."
          : "Test sent. Turn on Enable and save settings to schedule reminders.",
        normalizedSettings.enabled ? "success" : "warning",
      );
    } catch (error) {
      console.error("Failed to send ntfy test", error);
      setMessage("Could not send the notification test. Try again.", "warning");
    }
  }

  async function regenerateNtfyTopic({ setup = false } = {}) {
    if (setup) {
      syncSetupDraftFromDom();
    } else {
      await enqueueNtfyOperation("topic_regenerate_cancel", () =>
        cancelNtfyReminderStagesForEvents(state.events, persistedNtfySettings),
      );
    }

    state.ntfySettings = buildNtfySettings({
      enabled: true,
      topic: generateNtfyTopic(),
    });

    if (setup) {
      render();
      return;
    }

    syncAccountNtfyForm();
    setNtfyMessage("Notification channel regenerated.");
  }

  function getResolvedReminder(eventRecord, ntfySettings = state.ntfySettings) {
    const reminder = eventRecord.reminder ?? {};
    const inheritedMode =
      eventRecord.type === "deadline" ? ntfySettings.defaultDeadlineMode : ntfySettings.defaultExamMode;
    const mode = reminder.mode === "use-default" || !reminder.mode ? inheritedMode : reminder.mode;
    const times = reminder.mode === "use-default" || !reminder.times?.length ? ntfySettings.defaultTimes : reminder.times;

    return {
      mode,
      times: times.length ? times : ntfySettings.defaultTimes,
    };
  }

  function getNtfySequenceId(eventRecord, minutesBefore) {
    const rawId = `${eventRecord.id}-${minutesBefore}`;
    return rawId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  }

  function getNtfySequenceUrl(ntfySettings, eventRecord, minutesBefore) {
    return `${ntfySettings.serverUrl}/${encodeURIComponent(ntfySettings.topic)}/${encodeURIComponent(
      getNtfySequenceId(eventRecord, minutesBefore),
    )}`;
  }

  function getNtfyScheduleUrl(ntfySettings, eventRecord, stage) {
    const url = new URL(getNtfySequenceUrl(ntfySettings, eventRecord, stage.minutesBefore));
    url.searchParams.set("at", String(Math.floor(stage.sendAt.getTime() / 1000)));
    url.searchParams.set("title", eventRecord.type === "deadline" ? "Deadline Reminder" : "Exam Reminder");
    url.searchParams.set("priority", stage.minutesBefore <= 60 ? "5" : "4");
    url.searchParams.set("tags", eventRecord.type === "deadline" ? "calendar" : "warning,calendar");
    return url.toString();
  }

  function formatReminderLeadTime(minutesBefore) {
    if (minutesBefore === 1440) {
      return "tomorrow";
    }

    if (minutesBefore >= 60) {
      const hours = Math.round(minutesBefore / 60);
      return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    }

    return `in ${minutesBefore} minutes`;
  }

  function getEventReminderMessage(eventRecord, minutesBefore) {
    const label = `${eventRecord.course} ${eventRecord.event}`.trim();
    const leadTime = formatReminderLeadTime(minutesBefore);

    if (eventRecord.type === "deadline") {
      return `${label} is due ${leadTime}.`;
    }

    return `${label} starts ${leadTime}.`;
  }

  function getEventReminderAt(eventRecord) {
    const reminderAt = parseLocalDate(eventRecord.date);
    const timeValue =
      eventRecord.type === "deadline"
        ? eventRecord.startTime || eventRecord.endTime
        : eventRecord.startTime || eventRecord.endTime;

    if (!timeValue) {
      return getEventDueAt(eventRecord);
    }

    const [hours, minutes] = timeValue.split(":").map(Number);
    reminderAt.setHours(hours, minutes, 0, 0);
    return reminderAt;
  }

  function getSchedulableReminderStages(eventRecord, ntfySettings = state.ntfySettings, now = new Date()) {
    const normalizedSettings = normalizeNtfySettings(ntfySettings);
    const reminder = getResolvedReminder(eventRecord, normalizedSettings);

    if (!normalizedSettings.enabled || !normalizedSettings.topic || reminder.mode === "off") {
      return [];
    }

    const reminderAt = getEventReminderAt(eventRecord);
    const maxDelayMs = NTFY_SCHEDULE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    return reminder.times
      .map((minutesBefore) => {
        const sendAt = new Date(reminderAt.getTime() - minutesBefore * 60 * 1000);
        return { minutesBefore, sendAt };
      })
      .filter(({ sendAt }) => {
        const delayMs = sendAt.getTime() - now.getTime();
        return delayMs > 0 && delayMs <= maxDelayMs;
      });
  }

  async function scheduleNtfyReminderStage(eventRecord, stage, ntfySettings = state.ntfySettings) {
    if (stage.sendAt.getTime() <= Date.now() + NTFY_MIN_FUTURE_MS) {
      return false;
    }

    const normalizedSettings = normalizeNtfySettings(ntfySettings);
    await sendNtfyRequest(
      getNtfyScheduleUrl(normalizedSettings, eventRecord, stage),
      {
        method: "POST",
        body: getEventReminderMessage(eventRecord, stage.minutesBefore),
      },
    );
    return true;
  }

  function getBrowserReminderTimerId(eventRecord, minutesBefore) {
    return `${eventRecord.id}-${minutesBefore}`;
  }

  function showBrowserReminderNotification(eventRecord, stage) {
    if (!isBrowserNotificationSupported() || Notification.permission !== "granted") {
      return;
    }

    const title = eventRecord.type === "deadline" ? "Deadline Reminder" : "Exam Reminder";
    const body = getEventReminderMessage(eventRecord, stage.minutesBefore);

    try {
      new Notification(title, {
        body,
        icon: "./icon.png?v=1",
        tag: getBrowserReminderTimerId(eventRecord, stage.minutesBefore),
        renotify: true,
      });
    } catch (error) {
      console.warn("Could not show browser reminder notification", error);
    }
  }

  function clearBrowserReminderTimers() {
    for (const timerId of browserReminderTimers.values()) {
      window.clearTimeout(timerId);
    }

    browserReminderTimers = new Map();
  }

  function scheduleBrowserReminderTimers(eventsSnapshot = state.events) {
    if (!isBrowserReminderProviderActive() || !isBrowserNotificationSupported() || Notification.permission !== "granted") {
      clearBrowserReminderTimers();
      return { scheduled: 0 };
    }

    clearBrowserReminderTimers();

    const now = new Date();
    const browserSettings = getBrowserReminderSettings();
    let scheduled = 0;

    for (const eventRecord of eventsSnapshot) {
      if (isEventCompleted(eventRecord) || getEventDueAt(eventRecord).getTime() <= now.getTime()) {
        continue;
      }

      for (const stage of getSchedulableReminderStages(eventRecord, browserSettings, now)) {
        const delayMs = stage.sendAt.getTime() - Date.now();

        if (delayMs <= NTFY_MIN_FUTURE_MS) {
          continue;
        }

        const timerKey = getBrowserReminderTimerId(eventRecord, stage.minutesBefore);
        const timerId = window.setTimeout(() => {
          browserReminderTimers.delete(timerKey);
          showBrowserReminderNotification(eventRecord, stage);
        }, delayMs);

        browserReminderTimers.set(timerKey, timerId);
        scheduled += 1;
      }
    }

    return { scheduled };
  }

  function refreshActiveReminderSchedules() {
    if (isBrowserReminderProviderActive()) {
      scheduleBrowserReminderTimers();
      return;
    }

    requestNtfyReconcile({ force: true });
  }

  async function scheduleNtfyRemindersForEvents(eventsSnapshot = state.events, ntfySettings = state.ntfySettings) {
    const normalizedSettings = normalizeNtfySettings(ntfySettings);
    const expectedRevision = ntfyScheduleRevision;

    if (!normalizedSettings.enabled || !normalizedSettings.topic) {
      return { scheduled: 0, failed: 0 };
    }

    const upcomingEvents = eventsSnapshot.filter(
      (eventRecord) => !isEventCompleted(eventRecord) && getEventDueAt(eventRecord).getTime() > Date.now(),
    );
    const tasks = [];

    for (const eventRecord of upcomingEvents) {
      const stages = getSchedulableReminderStages(eventRecord, normalizedSettings);
      for (const stage of stages) {
        tasks.push(async () => {
          const scheduled = await scheduleNtfyReminderStage(eventRecord, stage, normalizedSettings);
          if (scheduled) {
            console.info(
              `Scheduled reminder for ${eventRecord.event} ${stage.minutesBefore} minutes before.`,
              stage.sendAt,
            );
            return 1;
          }
          return 0;
        });
      }
    }

    return runNtfyTasks(tasks, "Failed to schedule reminder", {
      concurrency: 1,
      spacingMs: NTFY_REQUEST_SPACING_MS,
      stopOnRateLimit: true,
      shouldContinue: () => isNtfyScheduleRevisionCurrent(expectedRevision),
    });
  }

  async function cancelNtfyReminderStages(
    eventRecord,
    ntfySettings = state.ntfySettings,
    minutesBeforeList = ALL_REMINDER_TIMES,
  ) {
    const normalizedSettings = normalizeNtfySettings(ntfySettings);

    if (!normalizedSettings.topic) {
      return;
    }

    for (const minutesBefore of minutesBeforeList) {
      try {
        await sendNtfyRequest(
          getNtfySequenceUrl(normalizedSettings, eventRecord, minutesBefore),
          { method: "DELETE" },
          { ignoreNotFound: true },
        );
        await wait(NTFY_REQUEST_SPACING_MS);
      } catch (error) {
        if (isNtfyRateLimitError(error)) {
          emitNtfyDebugLog("cancel_stopped_rate_limit", {
            eventId: eventRecord.id || "",
            minutesBefore: String(minutesBefore),
          });
          throw error;
        }
        console.error("Failed to cancel reminder", error);
      }
    }
  }

  async function cancelNtfyReminderStagesForEvents(eventsSnapshot, ntfySettings = state.ntfySettings) {
    for (const eventRecord of eventsSnapshot) {
      await cancelNtfyReminderStages(eventRecord, ntfySettings);

      if (getRateLimitRemainingMs() > 0) {
        break;
      }
    }
  }

  async function reconcileNtfyReminders({
    eventsSnapshot = state.events,
    nextSettings = state.ntfySettings,
    previousSettings = persistedNtfySettings,
  } = {}) {
    const expectedRevision = ntfyScheduleRevision;
    const now = new Date();
    const normalizedNextSettings = normalizeNtfySettings(nextSettings);
    const normalizedPreviousSettings = normalizeNtfySettings(previousSettings);
    const topicChanged = normalizedNextSettings.topic !== normalizedPreviousSettings.topic;
    const cancelTasks = [];
    const scheduleTasks = [];

    for (const eventRecord of eventsSnapshot) {
      if (isEventCompleted(eventRecord) || getEventDueAt(eventRecord).getTime() <= now.getTime()) {
        continue;
      }

      const previousStages = getSchedulableReminderStages(eventRecord, normalizedPreviousSettings, now);
      const nextStages = getSchedulableReminderStages(eventRecord, normalizedNextSettings, now);
      const nextMinutes = new Set(nextStages.map((stage) => stage.minutesBefore));
      const staleMinutes = topicChanged
        ? previousStages.map((stage) => stage.minutesBefore)
        : previousStages
            .map((stage) => stage.minutesBefore)
            .filter((minutesBefore) => !nextMinutes.has(minutesBefore));

      if (staleMinutes.length && normalizedPreviousSettings.topic) {
        cancelTasks.push(async () => {
          await cancelNtfyReminderStages(eventRecord, normalizedPreviousSettings, staleMinutes);
          return 0;
        });
      }

      for (const stage of nextStages) {
        scheduleTasks.push(async () => {
          const scheduled = await scheduleNtfyReminderStage(eventRecord, stage, normalizedNextSettings);
          if (scheduled) {
            console.info(
              `Scheduled reminder for ${eventRecord.event} ${stage.minutesBefore} minutes before.`,
              stage.sendAt,
            );
            return 1;
          }
          return 0;
        });
      }
    }

    emitNtfyDebugLog("reconcile_start", {
      events: String(eventsSnapshot.length),
      cancelTasks: String(cancelTasks.length),
      scheduleTasks: String(scheduleTasks.length),
    });

    const cancelResult = await runNtfyTasks(cancelTasks, "Failed to cancel reminder", {
      concurrency: 1,
      spacingMs: NTFY_REQUEST_SPACING_MS,
      stopOnRateLimit: true,
      shouldContinue: () => isNtfyScheduleRevisionCurrent(expectedRevision),
    });
    const result =
      getRateLimitRemainingMs() > 0 || !isNtfyScheduleRevisionCurrent(expectedRevision)
        ? { scheduled: 0, failed: 0 }
        : await runNtfyTasks(scheduleTasks, "Failed to schedule reminder", {
            concurrency: 1,
            spacingMs: NTFY_REQUEST_SPACING_MS,
            stopOnRateLimit: true,
            shouldContinue: () => isNtfyScheduleRevisionCurrent(expectedRevision),
          });

    emitNtfyDebugLog("reconcile_done", {
      scheduled: String(result.scheduled),
      failed: String(cancelResult.failed + result.failed),
    });

    return {
      scheduled: result.scheduled,
      failed: cancelResult.failed + result.failed,
    };
  }

  async function reconcileNtfyRemindersFull({
    eventsSnapshot = state.events,
    nextSettings = state.ntfySettings,
    previousSettings = persistedNtfySettings,
    onProgress = null,
  } = {}) {
    const expectedRevision = ntfyScheduleRevision;
    const now = new Date();
    const normalizedNextSettings = normalizeNtfySettings(nextSettings);
    const upcomingEvents = eventsSnapshot.filter(
      (eventRecord) => !isEventCompleted(eventRecord) && getEventDueAt(eventRecord).getTime() > now.getTime(),
    );
    const scheduleTasks = [];

    for (const eventRecord of upcomingEvents) {
      const stages = getSchedulableReminderStages(eventRecord, normalizedNextSettings, now);
      for (const stage of stages) {
        scheduleTasks.push(async () => {
          const scheduled = await scheduleNtfyReminderStage(eventRecord, stage, normalizedNextSettings);
          if (scheduled) {
            console.info(
              `Scheduled reminder for ${eventRecord.event} ${stage.minutesBefore} minutes before.`,
              stage.sendAt,
            );
            return 1;
          }
          return 0;
        });
      }
    }

    emitNtfyDebugLog("reconcile_full_start", {
      events: String(upcomingEvents.length),
      cancelTasks: "0",
      scheduleTasks: String(scheduleTasks.length),
    });

    const result = await runNtfyTasks(scheduleTasks, "Failed to schedule reminder", {
      concurrency: 1,
      onProgress,
      spacingMs: NTFY_REQUEST_SPACING_MS,
      stopOnRateLimit: true,
      shouldContinue: () => isNtfyScheduleRevisionCurrent(expectedRevision),
    });

    emitNtfyDebugLog("reconcile_full_done", {
      scheduled: String(result.scheduled),
      failed: String(result.failed),
    });

    return {
      scheduled: result.scheduled,
      failed: result.failed,
    };
  }

  async function reconcileNtfyReminderForEvent({
    previousEvent = null,
    nextEvent = null,
    previousSettings = persistedNtfySettings,
    nextSettings = state.ntfySettings,
  } = {}) {
    const now = new Date();
    const normalizedPreviousSettings = normalizeNtfySettings(previousSettings);
    const normalizedNextSettings = normalizeNtfySettings(nextSettings);
    const previousStages = previousEvent
      ? getSchedulableReminderStages(previousEvent, normalizedPreviousSettings, now)
      : [];
    const nextStages =
      nextEvent && !isEventCompleted(nextEvent) && getEventDueAt(nextEvent).getTime() > now.getTime()
        ? getSchedulableReminderStages(nextEvent, normalizedNextSettings, now)
        : [];
    const previousMinutes = [...new Set(previousStages.map((stage) => stage.minutesBefore))];

    if (previousEvent && previousMinutes.length) {
      await cancelNtfyReminderStages(previousEvent, normalizedPreviousSettings, previousMinutes);
    }

    const tasks = nextStages.map((stage) => async () => {
      const scheduled = await scheduleNtfyReminderStage(nextEvent, stage, normalizedNextSettings);
      return scheduled ? 1 : 0;
    });

    return runNtfyTasks(tasks, "Failed to schedule reminder", {
      concurrency: 1,
      spacingMs: NTFY_REQUEST_SPACING_MS,
      stopOnRateLimit: true,
    });
  }

  function getEventTargetedScheduleSummary(scheduleResult) {
    if (getRateLimitRemainingMs() > 0) {
      return {
        message: `Saved, but reminders are rate limited. Try again after ${formatRateLimitResumeTime()}.`,
        tone: "warning",
      };
    }

    if (scheduleResult.failed) {
      return {
        message: `Saved, but ${scheduleResult.failed} reminder${scheduleResult.failed === 1 ? "" : "s"} failed.`,
        tone: "warning",
      };
    }

    if (scheduleResult.scheduled) {
      return {
        message: `Saved. ${scheduleResult.scheduled} reminder${scheduleResult.scheduled === 1 ? "" : "s"} scheduled.`,
        tone: "success",
      };
    }

    return {
      message: "Saved. No future reminders are currently schedulable for this item.",
      tone: "warning",
    };
  }

  function setAddEventSubmitting(isSubmitting) {
    isAddingEvent = isSubmitting;
    dom.submitButton.disabled = isSubmitting;
    dom.submitButton.textContent = isSubmitting ? "Saving..." : TYPE_COPY[getSelectedType()].buttonLabel;
  }

  function setEditEventSubmitting(isSubmitting) {
    isEditingEvent = isSubmitting;
    dom.editSubmitButton.disabled = isSubmitting;
    dom.editSubmitButton.textContent = isSubmitting
      ? "Saving..."
      : getSelectedEditType() === "exam"
        ? "Save exam"
        : "Save deadline";
  }

  function reportEventNtfyScheduleResult(schedulePromise) {
    void schedulePromise
      .then((scheduleResult) => {
        const scheduleSummary = getEventTargetedScheduleSummary(scheduleResult);
        setAccountSettingsMessage(scheduleSummary.message, scheduleSummary.tone);
      })
      .catch((error) => {
        console.error("Failed to reconcile reminder for saved event", error);
        const message = isNtfyRateLimitError(error)
          ? `Saved, but reminders are rate limited. Try again after ${formatRateLimitResumeTime()}.`
          : "Saved, but reminder scheduling failed. Try again after checking the console.";
        setAccountSettingsMessage(message, "warning");
      });
  }

  async function prepareBrowserRemindersForUserAction() {
    if (!isBrowserReminderProviderActive()) {
      return null;
    }

    if (!isBrowserNotificationSupported()) {
      return { supported: false, granted: false };
    }

    return {
      supported: true,
      granted: await requestBrowserNotificationPermission(),
    };
  }

  function reportBrowserReminderScheduleResult(permissionInfo) {
    if (!permissionInfo?.supported) {
      setAccountSettingsMessage("Saved. Browser notifications are not supported on this device/browser.", "warning");
      return;
    }

    if (!permissionInfo.granted) {
      setAccountSettingsMessage("Saved. Allow notifications from the Home Screen app to receive reminders.", "warning");
      return;
    }

    const { scheduled } = scheduleBrowserReminderTimers();
    setAccountSettingsMessage(
      scheduled
        ? `Saved. ${scheduled} browser reminder${scheduled === 1 ? "" : "s"} scheduled on this device.`
        : "Saved. No future reminders are currently schedulable on this device.",
      scheduled ? "success" : "warning",
    );
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function getNtfyErrorBody(bodyText = "") {
    const trimmed = typeof bodyText === "string" ? bodyText.trim() : "";
    return trimmed ? `: ${trimmed.slice(0, 180)}` : "";
  }

  function getRetryDelayMs(response, attempt) {
    const retryAfterValue = Number(response?.headers?.get("Retry-After"));

    if (Number.isFinite(retryAfterValue) && retryAfterValue > 0) {
      return Math.max(NTFY_RATE_LIMIT_MIN_MS, retryAfterValue * 1000);
    }

    return NTFY_REQUEST_BACKOFF_MS * (attempt + 1);
  }

  function applyRateLimitCooldown(response) {
    const retryDelayMs = getRetryDelayMs(response, 0);
    const cooldownMs = Math.max(NTFY_RATE_LIMIT_MIN_MS, retryDelayMs || NTFY_RATE_LIMIT_DEFAULT_MS);
    ntfyRateLimitedUntil = Date.now() + cooldownMs;
    emitNtfyDebugLog("rate_limit_applied", {
      status: String(response?.status || 429),
      retryDelayMs: String(retryDelayMs || 0),
      cooldownMs: String(cooldownMs),
      retryAt: new Date(ntfyRateLimitedUntil).toISOString(),
    });
  }

  async function sendNtfyRequest(url, fetchOptions, { ignoreNotFound = false } = {}) {
    let lastError = null;
    const requestMethod = fetchOptions?.method || "GET";
    const requestTarget = getNtfyRequestTarget(url);
    const traceId = nextNtfyTraceId("req");

    if (getRateLimitRemainingMs() > 0) {
      emitNtfyDebugLog("request_blocked_rate_limit", {
        traceId,
        method: requestMethod,
        target: requestTarget,
        retryAt: formatRateLimitResumeTime(),
      });
      throw new Error(`ntfy temporarily rate limited; retry after ${formatRateLimitResumeTime()}`);
    }

    for (let attempt = 0; attempt <= NTFY_REQUEST_MAX_RETRIES; attempt += 1) {
      try {
        emitNtfyDebugLog("request_start", {
          traceId,
          method: requestMethod,
          target: requestTarget,
          attempt: String(attempt + 1),
        });

        const response = await fetch(url, fetchOptions);

        if (response.ok || (ignoreNotFound && response.status === 404)) {
          emitNtfyDebugLog("request_ok", {
            traceId,
            method: requestMethod,
            target: requestTarget,
            status: String(response.status),
            attempt: String(attempt + 1),
          });
          return response;
        }

        if (response.status === 429) {
          applyRateLimitCooldown(response);
        }

        const errorBody = getNtfyErrorBody(await response.text());
        const error = new Error(`ntfy request failed (${response.status})${errorBody}`);
        const shouldRetry = response.status >= 500 && attempt < NTFY_REQUEST_MAX_RETRIES;
        error.isRetryable = shouldRetry;

        if (!shouldRetry) {
          emitNtfyDebugLog("request_fail", {
            traceId,
            method: requestMethod,
            target: requestTarget,
            status: String(response.status),
            attempt: String(attempt + 1),
          });
          throw error;
        }

        lastError = error;
        emitNtfyDebugLog("request_retry", {
          traceId,
          method: requestMethod,
          target: requestTarget,
          status: String(response.status),
          attempt: String(attempt + 1),
        });
        await wait(getRetryDelayMs(response, attempt));
      } catch (error) {
        const shouldRetry = error?.isRetryable === true && attempt < NTFY_REQUEST_MAX_RETRIES;

        if (!shouldRetry) {
          emitNtfyDebugLog("request_error", {
            traceId,
            method: requestMethod,
            target: requestTarget,
            attempt: String(attempt + 1),
          });
          throw error;
        }

        lastError = error;
        emitNtfyDebugLog("request_retry_error", {
          traceId,
          method: requestMethod,
          target: requestTarget,
          attempt: String(attempt + 1),
        });
        await wait(NTFY_REQUEST_BACKOFF_MS * (attempt + 1));
      }
    }

    throw lastError || new Error("ntfy request failed");
  }

  function isNtfyRateLimitError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("rate limited") || message.includes("failed (429)");
  }

  function isNtfyDebugEnabled() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(NTFY_DEBUG_QUERY_PARAM) === "1";
    } catch {
      return false;
    }
  }

  function getNtfyRequestTarget(url) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments.at(-1) || "topic";
    } catch {
      return "unknown";
    }
  }

  function logNtfyConsoleEvent(event, details = {}) {
    const payload = {
      ...details,
      at: new Date().toISOString(),
    };

    if (event.includes("fail") || event.includes("error")) {
      console.error("[ntfy]", event, payload);
      return;
    }

    if (event.includes("retry") || event.includes("rate_limit")) {
      console.warn("[ntfy]", event, payload);
      return;
    }

    console.info("[ntfy]", event, payload);
  }

  function emitNtfyDebugLog(event, details = {}) {
    logNtfyConsoleEvent(event, details);

    if (!ntfyDebugEnabled) {
      return;
    }

    const params = new URLSearchParams({
      event,
      ...details,
      ts: String(Date.now()),
    });
    const debugPath = `/__ntfy-log?${params.toString()}`;

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(debugPath, "");
      } else {
        fetch(debugPath, { method: "GET", mode: "no-cors", cache: "no-store", keepalive: true }).catch(() => {});
      }
    } catch {
      // no-op
    }
  }

  async function runNtfyTasks(
    tasks,
    errorLabel = "ntfy request failed",
    {
      concurrency = NTFY_RECONCILE_CONCURRENCY,
      onProgress = null,
      spacingMs = 0,
      stopOnRateLimit = false,
      shouldContinue = null,
    } = {},
  ) {
    let scheduled = 0;
    let failed = 0;
    let completed = 0;
    let taskIndex = 0;
    let halted = false;
    let lastTaskStartedAt = 0;

    async function worker() {
      while (taskIndex < tasks.length && !halted) {
        if (typeof shouldContinue === "function" && !shouldContinue()) {
          halted = true;
          emitNtfyDebugLog("task_queue_halted_stale_revision", {
            errorLabel,
            remaining: String(Math.max(0, tasks.length - taskIndex)),
          });
          break;
        }

        const currentIndex = taskIndex;
        taskIndex += 1;

        try {
          const waitMs = Math.max(0, lastTaskStartedAt + spacingMs - Date.now());
          if (waitMs > 0) {
            await wait(waitMs);
          }

          if (typeof shouldContinue === "function" && !shouldContinue()) {
            halted = true;
            emitNtfyDebugLog("task_queue_halted_stale_revision", {
              errorLabel,
              remaining: String(Math.max(0, tasks.length - taskIndex)),
            });
            break;
          }

          lastTaskStartedAt = Date.now();

          const result = await tasks[currentIndex]();
          if (typeof result === "number" && result > 0) {
            scheduled += result;
          }
        } catch (error) {
          failed += 1;
          if (stopOnRateLimit && isNtfyRateLimitError(error)) {
            console.warn(errorLabel, error);
          } else {
            console.error(errorLabel, error);
          }

          if (stopOnRateLimit && isNtfyRateLimitError(error)) {
            halted = true;
            emitNtfyDebugLog("task_queue_halted_rate_limit", {
              errorLabel,
              failed: String(failed),
              remaining: String(Math.max(0, tasks.length - taskIndex)),
            });
          }
        } finally {
          completed += 1;
          if (typeof onProgress === "function") {
            onProgress({
              completed,
              failed,
              scheduled,
              total: tasks.length,
            });
          }
        }
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, tasks.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { scheduled, failed };
  }

  function requestNtfyReconcile({ force = false } = {}) {
    if (!isNtfyReminderProviderActive()) {
      return;
    }

    if (!state.user?.id || state.bootstrapStatus !== "ready") {
      return;
    }

    const now = Date.now();

    if (!force && now - lastNtfyReconcileAt < NTFY_RECONCILE_THROTTLE_MS) {
      return;
    }

    lastNtfyReconcileAt = now;
    void enqueueNtfyOperation("auto_reconcile", () => reconcileNtfyReminders()).catch((error) => {
      console.error("Automatic reminder reconciliation failed", error);
    });
  }

  function getCourseBySelection(courseName) {
    return getCourseByName(state.courses, courseName);
  }

  function getCourseDaysLabel(course) {
    if (!courseHasClassSchedule(course)) {
      return "class days";
    }

    return course.classDays
      .map((code) => COURSE_DAY_OPTIONS.find((day) => day.code === code)?.label ?? "")
      .filter(Boolean)
      .join(", ");
  }

  function normalizeDateValue(value, fallback = "") {
    const normalized = typeof value === "string" ? value.trim() : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
  }

  function isAuthSequenceStale(authSequence, userId = state.user?.id) {
    return authSequence !== activeAuthSequence || (userId && state.user?.id !== userId);
  }

  function resetSetupState(overrides = {}) {
    state.setup = createDefaultSetupState(overrides);
  }

  function getSelectedDeadlinePreset(presetInputs) {
    return presetInputs.find((input) => input.checked)?.dataset.deadlinePreset ?? "";
  }

  function setSelectedDeadlinePreset(presetInputs, selectedPreset) {
    presetInputs.forEach((input) => {
      input.checked = Boolean(selectedPreset) && input.dataset.deadlinePreset === selectedPreset;
    });
  }

  function syncDeadlinePresetSelection(presetInputs, changedInput) {
    if (!changedInput?.checked) {
      return;
    }

    setSelectedDeadlinePreset(presetInputs, changedInput.dataset.deadlinePreset ?? "");
  }

  function getComposerDeadlinePreset() {
    return getSelectedDeadlinePreset(dom.eventDeadlinePresetInputs);
  }

  function getEditDeadlinePreset() {
    return getSelectedDeadlinePreset(dom.editDeadlinePresetInputs);
  }

  function composerNeedsCourseDayPresetValidation() {
    if (getSelectedType() === "exam") {
      return dom.eventUseCourseTimingInput.checked;
    }

    return CLASS_BASED_DEADLINE_PRESETS.has(getComposerDeadlinePreset());
  }

  function editNeedsCourseDayPresetValidation() {
    if (getSelectedEditType() === "exam") {
      return dom.editEventUseCourseTimingInput.checked;
    }

    return CLASS_BASED_DEADLINE_PRESETS.has(getEditDeadlinePreset());
  }

  function getDeadlinePresetTime(preset, course) {
    if (preset === DEADLINE_PRESETS.beforeClass) {
      return course?.startTime ?? "";
    }

    if (preset === DEADLINE_PRESETS.afterClass) {
      return course?.endTime ?? "";
    }

    if (preset === DEADLINE_PRESETS.endOfDay) {
      return DEADLINE_END_OF_DAY_TIME;
    }

    return "";
  }

  function syncComposerPresetLabel() {
    const type = getSelectedType();
    dom.eventTimingPresetLabel.textContent = type === "exam" ? "During class" : "Before Class";
  }

  function syncEditPresetLabel() {
    const type = getSelectedEditType();
    dom.editTimingPresetLabel.textContent = type === "exam" ? "During class" : "Before Class";
  }

  function applyComposerCourseTimingPreset({ clearMessage = false } = {}) {
    syncComposerPresetLabel();
    const selectedType = getSelectedType();
    const isExam = selectedType === "exam";
    const selectedCourse = getCourseBySelection(dom.eventCourseSelect.value);
    const hasSchedule = courseHasClassSchedule(selectedCourse);
    let selectedDeadlinePreset = isExam ? "" : getComposerDeadlinePreset();
    const shouldLockCourseTimes = isExam && dom.eventUseCourseTimingInput.checked && hasSchedule;

    dom.eventUseCourseTimingInput.disabled = !hasSchedule;
    dom.eventDeadlineAfterClassInput.disabled = !hasSchedule;

    if (!hasSchedule) {
      if (isExam) {
        dom.eventUseCourseTimingInput.checked = false;
      } else if (CLASS_BASED_DEADLINE_PRESETS.has(selectedDeadlinePreset)) {
        setSelectedDeadlinePreset(dom.eventDeadlinePresetInputs, "");
        selectedDeadlinePreset = "";
      }
    }

    if (isExam && shouldLockCourseTimes && selectedCourse) {
      dom.eventStartTimeInput.value = selectedCourse.startTime;
      dom.eventEndTimeInput.value = selectedCourse.endTime;
    }

    if (!isExam && selectedDeadlinePreset) {
      dom.eventDueTimeInput.value = getDeadlinePresetTime(selectedDeadlinePreset, selectedCourse);
    }

    dom.eventStartTimeInput.disabled = shouldLockCourseTimes;
    dom.eventEndTimeInput.disabled = shouldLockCourseTimes;
    dom.eventDueTimeInput.disabled = !isExam && Boolean(selectedDeadlinePreset);

    if (clearMessage) {
      setFormMessage("");
    }
  }

  function applyEditCourseTimingPreset({ clearMessage = false } = {}) {
    syncEditPresetLabel();
    const selectedType = getSelectedEditType();
    const isExam = selectedType === "exam";
    const selectedCourse = getCourseBySelection(dom.editEventCourseSelect.value);
    const hasSchedule = courseHasClassSchedule(selectedCourse);
    let selectedDeadlinePreset = isExam ? "" : getEditDeadlinePreset();
    const shouldLockCourseTimes = isExam && dom.editEventUseCourseTimingInput.checked && hasSchedule;

    dom.editEventUseCourseTimingInput.disabled = !hasSchedule;
    dom.editDeadlineAfterClassInput.disabled = !hasSchedule;

    if (!hasSchedule) {
      if (isExam) {
        dom.editEventUseCourseTimingInput.checked = false;
      } else if (CLASS_BASED_DEADLINE_PRESETS.has(selectedDeadlinePreset)) {
        setSelectedDeadlinePreset(dom.editDeadlinePresetInputs, "");
        selectedDeadlinePreset = "";
      }
    }

    if (isExam && shouldLockCourseTimes && selectedCourse) {
      dom.editEventStartTimeInput.value = selectedCourse.startTime;
      dom.editEventEndTimeInput.value = selectedCourse.endTime;
    }

    if (!isExam && selectedDeadlinePreset) {
      dom.editEventDueTimeInput.value = getDeadlinePresetTime(selectedDeadlinePreset, selectedCourse);
    }

    dom.editEventStartTimeInput.disabled = shouldLockCourseTimes;
    dom.editEventEndTimeInput.disabled = shouldLockCourseTimes;
    dom.editEventDueTimeInput.disabled = !isExam && Boolean(selectedDeadlinePreset);

    if (clearMessage) {
      setEditFormMessage("");
    }
  }

  function validateComposerPresetDate({ clearInvalidDate = false } = {}) {
    if (!composerNeedsCourseDayPresetValidation()) {
      return true;
    }

    const selectedCourse = getCourseBySelection(dom.eventCourseSelect.value);

    if (!courseHasClassSchedule(selectedCourse)) {
      setFormMessage("This course does not have a class schedule yet.", "warning");
      return false;
    }

    if (!dom.eventDateInput.value) {
      return true;
    }

    if (!isDateOnCourseDay(dom.eventDateInput.value, selectedCourse)) {
      if (clearInvalidDate) {
        dom.eventDateInput.value = "";
      }
      setFormMessage(`Pick a date on class days: ${getCourseDaysLabel(selectedCourse)}.`, "warning");
      return false;
    }

    setFormMessage("");
    return true;
  }

  function validateEditPresetDate({ clearInvalidDate = false } = {}) {
    if (!editNeedsCourseDayPresetValidation()) {
      return true;
    }

    const selectedCourse = getCourseBySelection(dom.editEventCourseSelect.value);

    if (!courseHasClassSchedule(selectedCourse)) {
      setEditFormMessage("This course does not have a class schedule yet.", "warning");
      return false;
    }

    if (!dom.editEventDateInput.value) {
      return true;
    }

    if (!isDateOnCourseDay(dom.editEventDateInput.value, selectedCourse)) {
      if (clearInvalidDate) {
        dom.editEventDateInput.value = "";
      }
      setEditFormMessage(`Pick a date on class days: ${getCourseDaysLabel(selectedCourse)}.`, "warning");
      return false;
    }

    setEditFormMessage("");
    return true;
  }

  function restoreFocus() {
    if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
      lastFocusedElement.focus();
    }

    lastFocusedElement = null;
  }

  function getManagedModals() {
    return [
      dom.composerModal,
      dom.coursesModal,
      dom.editModal,
      dom.confirmModal,
      dom.accountModal,
      dom.deleteAccountModal,
    ];
  }

  function openModal(modal, focusTarget) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    dom.pageShell.classList.add("modal-open");

    if (focusTarget) {
      focusTarget.focus();
    }
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    if (!getManagedModals().some((item) => item.classList.contains("is-open"))) {
      dom.pageShell.classList.remove("modal-open");
    }
  }

  function closeAllModals() {
    getManagedModals().forEach((modal) => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    });
    dom.pageShell.classList.remove("modal-open");
    confirmAction = null;
    editingEventId = null;
    resetCourseFormEditor();
    resetDeleteAccountModalState();
    lastFocusedElement = null;
  }

  function sanitizeFilters() {
    if (!["all", "exam", "deadline"].includes(state.filters.type)) {
      state.filters.type = "all";
    }

    if (!STATUS_FILTERS.has(state.filters.status)) {
      state.filters.status = DEFAULT_FILTERS.status;
    }

    if (state.filters.course !== "all" && !getCourseNames().includes(state.filters.course)) {
      state.filters.course = "all";
    }
  }

  function syncComposerUI() {
    const type = getSelectedType();
    const isExam = type === "exam";
    const copy = TYPE_COPY[type];

    dom.submitButton.textContent = copy.buttonLabel;
    dom.eventNameInput.placeholder = copy.titlePlaceholder;
    dom.examTimeGroup.classList.toggle("is-hidden", !isExam);
    dom.deadlineTimeField.classList.toggle("is-hidden", isExam);
    dom.eventDeadlinePresetGroup.classList.toggle("is-hidden", isExam);
    dom.eventStartTimeInput.required = isExam;
    dom.eventEndTimeInput.required = isExam;
    dom.eventDueTimeInput.required = !isExam;
    applyComposerCourseTimingPreset();
  }

  function syncEditUI() {
    const type = getSelectedEditType();
    const isExam = type === "exam";
    const copy = TYPE_COPY[type];

    dom.editSubmitButton.textContent = type === "exam" ? "Save exam" : "Save deadline";
    dom.editEventNameInput.placeholder = copy.titlePlaceholder;
    dom.editExamTimeGroup.classList.toggle("is-hidden", !isExam);
    dom.editDeadlineTimeField.classList.toggle("is-hidden", isExam);
    dom.editDeadlinePresetGroup.classList.toggle("is-hidden", isExam);
    dom.editEventStartTimeInput.required = isExam;
    dom.editEventEndTimeInput.required = isExam;
    dom.editEventDueTimeInput.required = !isExam;
    applyEditCourseTimingPreset();
  }

  function render() {
    sanitizeFilters();
    renderApp({ dom, state });
    syncComposerUI();
    syncEditUI();
  }

  function renderSetupScreen() {
    state.bootstrapStatus = "setup";
    render();
    requestAnimationFrame(() => {
      dom.authScreen.querySelector("#setupSemesterLabelInput")?.focus();
    });
  }

  function resetEventForm() {
    dom.eventForm.reset();
    setSelectedType("exam");
    dom.eventDateInput.value = formatDateValue(startOfToday());
    dom.eventCourseSelect.value = getCourseNames()[0] ?? "";
    dom.eventUseCourseTimingInput.checked = false;
    setSelectedDeadlinePreset(dom.eventDeadlinePresetInputs, "");
    dom.eventReminderModeSelect.value = "use-default";
    syncComposerUI();
    setFormMessage("");
  }

  function resetCourseFormEditor() {
    editingCourseOriginalName = null;
    dom.courseForm.reset();
    dom.courseSubmitButton.textContent = "Add course";
    dom.cancelCourseEditButton.classList.add("is-hidden");
  }

  function resetEditForm() {
    editingEventId = null;
    dom.editEventForm.reset();
    setSelectedEditType("exam");
    dom.editEventDateInput.value = formatDateValue(startOfToday());
    dom.editEventCourseSelect.value = getCourseNames()[0] ?? "";
    dom.editEventUseCourseTimingInput.checked = false;
    setSelectedDeadlinePreset(dom.editDeadlinePresetInputs, "");
    dom.editEventReminderModeSelect.value = "use-default";
    syncEditUI();
    setEditFormMessage("");
  }

  function resetScheduleState() {
    state.events = [];
    state.courses = [];
    state.preferences = {
      semester: DEFAULT_SEMESTER_LABEL,
      startDate: DEFAULT_SEMESTER_START_DATE,
      endDate: DEFAULT_SEMESTER_END_DATE,
    };
    state.ntfySettings = normalizeNtfySettings({
      enabled: true,
      topic: generateNtfyTopic(),
    });
    persistedNtfySettings = normalizeNtfySettings(state.ntfySettings);
    state.filters = { ...DEFAULT_FILTERS };
  }

  function resetDeleteAccountModalState() {
    isDeletingAccount = false;
    dom.deleteAccountConfirmInput.value = "";
    dom.deleteAccountConfirmInput.disabled = false;
    dom.deleteAccountCancelButton.disabled = false;
    dom.deleteAccountConfirmButton.disabled = true;
    dom.deleteAccountConfirmButton.textContent = "Delete Account";
    setDeleteAccountMessage("");
  }

  function syncDeleteAccountConfirmState() {
    const isConfirmed = dom.deleteAccountConfirmInput.value.trim() === "DELETE";
    dom.deleteAccountConfirmButton.disabled = isDeletingAccount || !isConfirmed;
    dom.deleteAccountCancelButton.disabled = isDeletingAccount;
    dom.deleteAccountConfirmInput.disabled = isDeletingAccount;
    dom.deleteAccountConfirmButton.textContent = isDeletingAccount ? "Deleting..." : "Delete Account";
  }

  function openComposer() {
    if (!state.courses.length) {
      openCourses();
      return;
    }

    lastFocusedElement = dom.openComposerButton;
    resetEventForm();
    openModal(dom.composerModal, dom.eventNameInput);
  }

  function closeComposer() {
    closeModal(dom.composerModal);
    restoreFocus();
  }

  function openCourses() {
    lastFocusedElement = dom.openCoursesButton;
    resetCourseFormEditor();
    setCourseMessage("");
    openModal(dom.coursesModal, dom.courseNameInput);
  }

  function closeCourses() {
    resetCourseFormEditor();
    closeModal(dom.coursesModal);
    restoreFocus();
  }

  function openEdit(eventRecord, originElement) {
    if (!eventRecord) {
      return;
    }

    if (!state.courses.length) {
      openCourses();
      return;
    }

    editingEventId = eventRecord.id;
    lastFocusedElement =
      originElement instanceof HTMLElement
        ? originElement
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setSelectedEditType(eventRecord.type);
    dom.editEventNameInput.value = eventRecord.event;
    dom.editEventDateInput.value = eventRecord.date;
    dom.editEventCourseSelect.value = eventRecord.course;
    dom.editEventUseCourseTimingInput.checked = false;
    setSelectedDeadlinePreset(dom.editDeadlinePresetInputs, "");
    dom.editEventNotesInput.value = eventRecord.notes ?? "";
    dom.editEventStartTimeInput.value = eventRecord.startTime ?? "";
    dom.editEventEndTimeInput.value = eventRecord.endTime ?? "";
    dom.editEventDueTimeInput.value = eventRecord.startTime ?? eventRecord.endTime ?? "";
    dom.editEventReminderModeSelect.value =
      eventRecord.reminder?.mode === "off"
        ? "off"
        : eventRecord.reminder?.mode === "selected-times"
          ? "selected-times"
          : "use-default";
    syncEditUI();
    setEditFormMessage("");
    openModal(dom.editModal, dom.editEventNameInput);
  }

  function closeEdit() {
    resetEditForm();
    closeModal(dom.editModal);
    restoreFocus();
  }

  function syncAccountNtfyForm() {
    const ntfySettings = normalizeNtfySettings(state.ntfySettings);

    dom.ntfyEnabledInput.checked = ntfySettings.enabled || Boolean(ntfySettings.topic);
    dom.ntfyTopicInput.value = ntfySettings.topic || generateNtfyTopic();
    dom.ntfyExamModeSelect.value = ntfySettings.defaultExamMode === "off" ? "off" : "selected-times";
    dom.ntfyDeadlineModeSelect.value = ntfySettings.defaultDeadlineMode === "off" ? "off" : "selected-times";
    syncReminderTimeInputs(dom.ntfyTimeInputs, ntfySettings.defaultTimes);
  }

  function openAccountSettings() {
    if (!state.user) {
      return;
    }

    lastFocusedElement = dom.accountButton;
    dom.accountDisplayName.textContent = state.user.displayName || "Signed in user";
    dom.semesterInput.value = state.preferences.semester;
    dom.semesterStartDateInput.value = state.preferences.startDate;
    dom.semesterEndDateInput.value = state.preferences.endDate;
    syncAccountNtfyForm();
    setAccountSettingsMessage("");
    openModal(dom.accountModal, dom.semesterInput);
  }

  function closeAccountSettings() {
    closeModal(dom.accountModal);
    restoreFocus();
  }

  function openDeleteAccountModal() {
    if (!state.user) {
      return;
    }

    lastFocusedElement = dom.openDeleteAccountButton;
    resetDeleteAccountModalState();
    openModal(dom.deleteAccountModal, dom.deleteAccountConfirmInput);
  }

  function closeDeleteAccountModal() {
    if (isDeletingAccount) {
      return;
    }

    closeModal(dom.deleteAccountModal);
    restoreFocus();
  }

  function openConfirm({ title, body, action, confirmLabel = "Delete" }) {
    confirmAction = action;
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dom.confirmTitle.textContent = title;
    dom.confirmBody.textContent = body;
    dom.confirmApproveButton.textContent = confirmLabel;
    openModal(dom.confirmModal, dom.confirmCancelButton);
  }

  function closeConfirm() {
    confirmAction = null;
    closeModal(dom.confirmModal);
    restoreFocus();
  }

  function requireUserId() {
    return state.user?.id ?? null;
  }

  async function persistEvents(eventsSnapshot = state.events, userId = requireUserId()) {
    if (!userId) {
      return;
    }

    await scheduleRepository.saveEvents(userId, eventsSnapshot);
  }

  function enqueueEventPersistence(eventsSnapshot, userId = requireUserId()) {
    const persistTask = eventPersistenceQueue.catch(() => {}).then(() => persistEvents(eventsSnapshot, userId));
    eventPersistenceQueue = persistTask.catch(() => {});
    return persistTask;
  }

  async function persistCourses() {
    const userId = requireUserId();

    if (!userId) {
      return;
    }

    await scheduleRepository.saveCourses(userId, state.courses);
  }

  async function saveSemesterSettings({
    semesterLabel,
    semesterStart = "",
    semesterEnd = "",
    ntfySettings = state.ntfySettings,
    markSetupComplete = false,
  }) {
    const userId = requireUserId();

    if (!userId) {
      return null;
    }

    const savedState = await scheduleRepository.saveSemesterSettings(
      userId,
      {
        semesterLabel,
        semesterStart,
        semesterEnd,
        ntfySettings,
      },
      { markSetupComplete },
    );

    state.preferences = {
      semester: savedState?.semesterLabel || DEFAULT_SEMESTER_LABEL,
      startDate: savedState?.semesterStart || "",
      endDate: savedState?.semesterEnd || "",
    };
    state.ntfySettings = normalizeNtfySettings(savedState?.ntfySettings);
    persistedNtfySettings = normalizeNtfySettings(state.ntfySettings);

    return savedState;
  }

  async function createInitialUserDoc(user) {
    if (!user?.id) {
      return null;
    }

    return scheduleRepository.createInitialUserDoc(user.id);
  }

  async function checkUserSetupState(user) {
    if (!user?.id) {
      return null;
    }

    const setupState = await scheduleRepository.checkUserSetupState(user.id);
    return setupState ?? createInitialUserDoc(user);
  }

  async function createCourseFromSetup(setupState) {
    const userId = requireUserId();

    if (!userId) {
      return null;
    }

    const course = normalizeCourse({
      name: setupState.courseName,
      classDays: setupState.courseDays,
      startTime: setupState.courseStartTime,
      endTime: setupState.courseEndTime,
    });

    if (!course) {
      return null;
    }

    return scheduleRepository.createCourseFromSetup(userId, course);
  }

  async function loadMainAppForCurrentUser({ authSequence = activeAuthSequence } = {}) {
    if (!state.user?.id) {
      state.bootstrapStatus = "ready";
      render();
      return;
    }

    state.bootstrapStatus = "loading";
    state.errorMessage = "";
    render();

    try {
      await scheduleRepository.migrateLocalDataIfNeeded(state.user.id);
      const schedule = await scheduleRepository.loadSchedule(state.user.id);

      if (isAuthSequenceStale(authSequence)) {
        return;
      }

      state.events = sortEvents(schedule.events);
      state.courses = sortCourses((schedule.courses ?? []).map(normalizeCourse).filter(Boolean));
      state.ntfySettings = normalizeNtfySettings(schedule.ntfySettings);
      persistedNtfySettings = normalizeNtfySettings(state.ntfySettings);

      const loadedStartDate = normalizeDateValue(schedule.preferences?.startDate);
      const loadedEndDate = normalizeDateValue(schedule.preferences?.endDate);

      state.preferences = {
        semester:
          typeof schedule.preferences?.semester === "string" && schedule.preferences.semester.trim()
            ? schedule.preferences.semester.trim()
            : DEFAULT_SEMESTER_LABEL,
        startDate:
          loadedStartDate && loadedEndDate && loadedStartDate > loadedEndDate
            ? loadedEndDate
            : loadedStartDate,
        endDate:
          loadedStartDate && loadedEndDate && loadedStartDate > loadedEndDate
            ? loadedStartDate
            : loadedEndDate,
      };
      state.bootstrapStatus = "ready";
      render();
      refreshActiveReminderSchedules();
      consumeHashAction();
    } catch (error) {
      if (isAuthSequenceStale(authSequence)) {
        return;
      }

      console.error("Failed to load schedule", error);
      state.bootstrapStatus = "error";
      state.errorMessage = "The app could not load this account data.";
      render();
    }
  }

  async function bootstrapAuthenticatedUser(user) {
    const authSequence = ++activeAuthSequence;

    closeAllModals();
    resetScheduleState();
    resetSetupState();
    state.errorMessage = "";
    state.user = user;
    state.sessionStatus = user ? "signed-in" : "signed-out";

    if (!user) {
      state.bootstrapStatus = "ready";
      render();
      return;
    }

    state.bootstrapStatus = "loading";
    render();

    try {
      const setupState = await checkUserSetupState(user);

      if (isAuthSequenceStale(authSequence, user.id)) {
        return;
      }

      if (!setupState?.hasCompletedSetup) {
        resetSetupState({
          semesterLabel: setupState?.semesterLabel || "",
          semesterStart: setupState?.semesterStart || "",
          semesterEnd: setupState?.semesterEnd || "",
        });
        state.ntfySettings = normalizeNtfySettings(
          setupState?.ntfySettings?.topic
            ? setupState.ntfySettings
            : {
                ...setupState?.ntfySettings,
                topic: generateNtfyTopic(),
              },
        );
        persistedNtfySettings = normalizeNtfySettings(state.ntfySettings);
        renderSetupScreen();
        return;
      }

      await loadMainAppForCurrentUser({ authSequence });
    } catch (error) {
      if (isAuthSequenceStale(authSequence, user.id)) {
        return;
      }

      console.error("Failed to check setup state", error);
      state.bootstrapStatus = "error";
      state.errorMessage = "The app could not load this account data.";
      render();
    }
  }

  function handleAuthStateChange(user) {
    if (!state.authInitialized) {
      state.authInitialized = true;
    }

    void bootstrapAuthenticatedUser(user);
  }

  function readSetupFormValues() {
    const setupForm = dom.authScreen.querySelector("#setupForm");

    if (!(setupForm instanceof HTMLFormElement)) {
      return { ...state.setup };
    }

    const semesterLabelInput = setupForm.querySelector("#setupSemesterLabelInput");
    const semesterStartInput = setupForm.querySelector("#setupSemesterStartInput");
    const semesterEndInput = setupForm.querySelector("#setupSemesterEndInput");
    const courseNameInput = setupForm.querySelector("#setupCourseNameInput");
    const courseStartTimeInput = setupForm.querySelector("#setupCourseStartTimeInput");
    const courseEndTimeInput = setupForm.querySelector("#setupCourseEndTimeInput");
    const courseDayInputs = [...setupForm.querySelectorAll('input[name="setup_course_day"]')];

    return {
      ...state.setup,
      semesterLabel: typeof semesterLabelInput?.value === "string" ? semesterLabelInput.value.trim() : "",
      semesterStart: normalizeDateValue(semesterStartInput?.value ?? ""),
      semesterEnd: normalizeDateValue(semesterEndInput?.value ?? ""),
      courseName: typeof courseNameInput?.value === "string" ? courseNameInput.value.trim() : "",
      courseDays: courseDayInputs.filter((input) => input.checked).map((input) => input.value),
      courseStartTime: normalizeClockTime(courseStartTimeInput?.value ?? ""),
      courseEndTime: normalizeClockTime(courseEndTimeInput?.value ?? ""),
    };
  }

  function syncSetupDraftFromDom() {
    if (state.bootstrapStatus !== "setup") {
      return;
    }

    state.setup = {
      ...readSetupFormValues(),
      message: state.setup.message,
      messageTone: state.setup.messageTone,
      isSubmitting: state.setup.isSubmitting,
    };
    state.ntfySettings = readSetupNtfySettings();
  }

  function isSetupCourseStarted(setupState) {
    return Boolean(
      setupState.courseName ||
        setupState.courseDays.length ||
        setupState.courseStartTime ||
        setupState.courseEndTime,
    );
  }

  async function handleSetupSubmit(event) {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "setupForm") {
      return;
    }

    event.preventDefault();

    const nextSetupState = readSetupFormValues();
    const nextNtfySettings = readSetupNtfySettings();
    state.setup = {
      ...nextSetupState,
      message: "",
      messageTone: "warning",
      isSubmitting: false,
    };

    if (!nextSetupState.semesterLabel) {
      setSetupMessage("Semester label is required.");
      return;
    }

    if (
      nextSetupState.semesterStart &&
      nextSetupState.semesterEnd &&
      nextSetupState.semesterStart > nextSetupState.semesterEnd
    ) {
      setSetupMessage("Semester start date must be before end date.");
      return;
    }

    if (isSetupCourseStarted(nextSetupState)) {
      if (!nextSetupState.courseName) {
        setSetupMessage("Enter a course name or leave the course section blank.");
        return;
      }

      if (!nextSetupState.courseDays.length) {
        setSetupMessage("Select at least one class day for your first course.");
        return;
      }

      if (!nextSetupState.courseStartTime || !nextSetupState.courseEndTime) {
        setSetupMessage("Set both class start and end times for your first course.");
        return;
      }

      if (nextSetupState.courseStartTime >= nextSetupState.courseEndTime) {
        setSetupMessage("Class end time must be after start time.");
        return;
      }
    }

    state.setup = {
      ...nextSetupState,
      message: "",
      messageTone: "warning",
      isSubmitting: true,
    };
    render();

    try {
      await saveSemesterSettings({
        semesterLabel: nextSetupState.semesterLabel,
        semesterStart: nextSetupState.semesterStart,
        semesterEnd: nextSetupState.semesterEnd,
        ntfySettings: nextNtfySettings,
        markSetupComplete: true,
      });

      if (isSetupCourseStarted(nextSetupState)) {
        await createCourseFromSetup(nextSetupState);
      }

      resetSetupState();
      await loadMainAppForCurrentUser();
    } catch (error) {
      console.error("Failed to complete setup", error);
      state.setup = {
        ...nextSetupState,
        message: "Failed to save setup. Try again.",
        messageTone: "warning",
        isSubmitting: false,
      };
      render();
    }
  }

  async function handleAddEvent(event) {
    event.preventDefault();

    if (isAddingEvent) {
      return;
    }

    applyComposerCourseTimingPreset();

    if (!validateComposerPresetDate()) {
      return;
    }

    const selectedType = getSelectedType();
    const eventTime = buildEventTime({
      type: selectedType,
      dueTime: dom.eventDueTimeInput.value,
      startTime: dom.eventStartTimeInput.value,
      endTime: dom.eventEndTimeInput.value,
    });

    const newEvent = normalizeEvent({
      type: selectedType,
      date: dom.eventDateInput.value,
      course: dom.eventCourseSelect.value,
      event: dom.eventNameInput.value,
      startTime: eventTime.startTime,
      endTime: eventTime.endTime,
      displayTime: eventTime.displayTime,
      notes: dom.eventNotesInput.value,
      reminder: {
        mode: dom.eventReminderModeSelect.value,
        customized: dom.eventReminderModeSelect.value !== "use-default",
      },
    });

    if (!isValidEvent(newEvent)) {
      setFormMessage("Fill in the title, course, date, and time fields.", "warning");
      return;
    }

    const browserReminderPermission = await prepareBrowserRemindersForUserAction();
    const previousEvents = state.events;
    setAddEventSubmitting(true);

    try {
      markNtfyScheduleChanged("event_add");
      state.events = sortEvents([...state.events, newEvent]);
      await persistEvents();
      render();
      closeComposer();
      if (isBrowserReminderProviderActive()) {
        reportBrowserReminderScheduleResult(browserReminderPermission);
      } else {
        setAccountSettingsMessage("Saved. Scheduling reminders now...", "success");
        reportEventNtfyScheduleResult(
          enqueueNtfyOperation("event_add", () => reconcileNtfyReminderForEvent({ nextEvent: newEvent })),
        );
      }
    } catch (error) {
      state.events = previousEvents;
      console.error("Failed to save event", error);
      setFormMessage("This item could not be saved. Try again.", "warning");
      render();
    } finally {
      setAddEventSubmitting(false);
    }
  }

  async function handleEditEvent(event) {
    event.preventDefault();

    if (isEditingEvent) {
      return;
    }

    applyEditCourseTimingPreset();

    if (!editingEventId) {
      setEditFormMessage("Select an event to edit first.", "warning");
      return;
    }

    if (!validateEditPresetDate()) {
      return;
    }

    const selectedType = getSelectedEditType();
    const eventTime = buildEventTime({
      type: selectedType,
      dueTime: dom.editEventDueTimeInput.value,
      startTime: dom.editEventStartTimeInput.value,
      endTime: dom.editEventEndTimeInput.value,
    });

    const previousEvent = state.events.find((item) => item.id === editingEventId);

    if (!previousEvent) {
      setEditFormMessage("This event no longer exists.", "warning");
      return;
    }

    const nextReminderMode = dom.editEventReminderModeSelect.value;
    const reminderTimingChanged =
      previousEvent.date !== dom.editEventDateInput.value ||
      previousEvent.startTime !== eventTime.startTime ||
      previousEvent.endTime !== eventTime.endTime ||
      previousEvent.reminder?.mode !== nextReminderMode;
    const nextReminder = reminderTimingChanged
      ? {
          ...previousEvent.reminder,
          mode: nextReminderMode,
          customized: nextReminderMode !== "use-default",
          sent: [],
          acknowledgedAt: "",
          snoozedUntil: "",
          lastRepeatSentAt: "",
          actionToken: "",
        }
      : {
          ...previousEvent.reminder,
          mode: nextReminderMode,
          customized: nextReminderMode !== "use-default",
        };

    const updatedEvent = normalizeEvent({
      ...previousEvent,
      id: editingEventId,
      type: selectedType,
      date: dom.editEventDateInput.value,
      course: dom.editEventCourseSelect.value,
      event: dom.editEventNameInput.value,
      startTime: eventTime.startTime,
      endTime: eventTime.endTime,
      displayTime: eventTime.displayTime,
      notes: dom.editEventNotesInput.value,
      reminder: nextReminder,
    });

    if (!isValidEvent(updatedEvent)) {
      setEditFormMessage("Fill in the title, course, date, and time fields.", "warning");
      return;
    }

    const browserReminderPermission = await prepareBrowserRemindersForUserAction();
    const previousEvents = state.events;
    setEditEventSubmitting(true);

    try {
      markNtfyScheduleChanged("event_edit");
      state.events = sortEvents(state.events.map((item) => (item.id === editingEventId ? updatedEvent : item)));
      await persistEvents();
      render();
      closeEdit();
      if (isBrowserReminderProviderActive()) {
        reportBrowserReminderScheduleResult(browserReminderPermission);
      } else {
        setAccountSettingsMessage("Saved. Scheduling reminders now...", "success");
        reportEventNtfyScheduleResult(
          enqueueNtfyOperation("event_edit", () =>
            reconcileNtfyReminderForEvent({
              previousEvent,
              nextEvent: updatedEvent,
            }),
          ),
        );
      }
    } catch (error) {
      state.events = previousEvents;
      console.error("Failed to save event", error);
      setEditFormMessage("This item could not be saved. Try again.", "warning");
      render();
    } finally {
      setEditEventSubmitting(false);
    }
  }

  async function handleAddCourse(event) {
    event.preventDefault();

    const courseName = typeof dom.courseNameInput.value === "string" ? dom.courseNameInput.value.trim() : "";
    const classDays = dom.courseDayInputs.filter((input) => input.checked).map((input) => input.value);
    const startTime = normalizeClockTime(dom.courseStartTimeInput.value);
    const endTime = normalizeClockTime(dom.courseEndTimeInput.value);

    if (!courseName) {
      setCourseMessage("Enter a course name first.", "warning");
      return;
    }

    if (!classDays.length) {
      setCourseMessage("Select at least one class day.", "warning");
      return;
    }

    if (!startTime || !endTime) {
      setCourseMessage("Set both class start and end times.", "warning");
      return;
    }

    if (startTime >= endTime) {
      setCourseMessage("Class end time must be after start time.", "warning");
      return;
    }

    const nextCourse = normalizeCourse({
      name: courseName,
      classDays,
      startTime,
      endTime,
    });

    if (!nextCourse) {
      setCourseMessage("This course could not be saved. Try again.", "warning");
      return;
    }

    if (editingCourseOriginalName) {
      const editingIndex = state.courses.findIndex((course) =>
        courseNameEquals(getCourseName(course), editingCourseOriginalName),
      );

      if (editingIndex < 0) {
        resetCourseFormEditor();
        setCourseMessage("That course could not be found. Try again.", "warning");
        return;
      }

      const conflictsWithAnotherCourse = state.courses.some((course, index) => {
        if (index === editingIndex) {
          return false;
        }

        return courseNameEquals(getCourseName(course), nextCourse.name);
      });

      if (conflictsWithAnotherCourse) {
        setCourseMessage("Another course already uses that name.", "warning");
        return;
      }

      state.courses = sortCourses(state.courses.map((course, index) => (index === editingIndex ? nextCourse : course)));

      if (!courseNameEquals(editingCourseOriginalName, nextCourse.name)) {
        markNtfyScheduleChanged("course_rename");
        state.events = sortEvents(
          state.events.map((item) =>
            courseNameEquals(item.course, editingCourseOriginalName)
              ? {
                  ...item,
                  course: nextCourse.name,
                }
              : item,
          ),
        );
        await persistEvents();
        void enqueueNtfyOperation("course_rename_reconcile", () => reconcileNtfyReminders()).catch((error) => {
          console.error("Failed to reconcile reminders after course rename", error);
        });

        if (courseNameEquals(state.filters.course, editingCourseOriginalName)) {
          state.filters.course = nextCourse.name;
        }
      }

      await persistCourses();
      render();
      refreshActiveReminderSchedules();
      resetCourseFormEditor();
      setCourseMessage(`${nextCourse.name} updated.`);
      dom.courseNameInput.focus();
      return;
    }

    const existingCourseIndex = state.courses.findIndex((course) =>
      courseNameEquals(getCourseName(course), nextCourse.name),
    );

    if (existingCourseIndex >= 0) {
      state.courses = sortCourses(
        state.courses.map((course, index) => (index === existingCourseIndex ? nextCourse : course)),
      );
      await persistCourses();
      render();
      refreshActiveReminderSchedules();
      resetCourseFormEditor();
      setCourseMessage(`${nextCourse.name} updated.`);
      dom.courseNameInput.focus();
      return;
    }

    state.courses = sortCourses([...state.courses, nextCourse]);
    await persistCourses();
    render();
    refreshActiveReminderSchedules();
    resetCourseFormEditor();
    setCourseMessage(`${nextCourse.name} added.`);
    dom.courseNameInput.focus();
  }

  async function handleSaveAccountSettings(event) {
    event.preventDefault();

    const semester = typeof dom.semesterInput.value === "string" ? dom.semesterInput.value.trim() : "";
    const startDate = normalizeDateValue(dom.semesterStartDateInput.value);
    const endDate = normalizeDateValue(dom.semesterEndDateInput.value);
    const ntfySettings = readAccountNtfySettings();
    const previousNtfySettings = normalizeNtfySettings(persistedNtfySettings);

    if (!semester) {
      setAccountSettingsMessage("Enter your semester label to save settings.", "warning");
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      setAccountSettingsMessage("Semester start date must be before end date.", "warning");
      return;
    }

    await saveSemesterSettings({
      semesterLabel: semester,
      semesterStart: startDate,
      semesterEnd: endDate,
      ntfySettings,
      markSetupComplete: false,
    });
    markNtfyScheduleChanged("settings_save");
    const scheduleResult = await enqueueNtfyOperation("settings_reconcile", () =>
      reconcileNtfyReminders({
        eventsSnapshot: state.events,
        nextSettings: ntfySettings,
        previousSettings: previousNtfySettings,
      }),
    );
    persistedNtfySettings = normalizeNtfySettings(ntfySettings);
    render();
    refreshActiveReminderSchedules();
    setAccountSettingsMessage(
      scheduleResult.failed
        ? "Settings saved, but reminders could not fully sync."
        : "Settings saved.",
      scheduleResult.failed ? "warning" : "success",
    );
  }

  async function handleManualNtfySchedule() {
    const traceId = nextNtfyTraceId("manual");

    if (!state.user?.id || state.bootstrapStatus !== "ready") {
      emitNtfyDebugLog("manual_schedule_blocked_unready", { traceId });
      setAccountSettingsMessage("Load your schedule first, then try scheduling again.", "warning");
      return;
    }

    state.ntfySettings = readAccountNtfySettings();
    const nextSettings = normalizeNtfySettings(state.ntfySettings);
    const previousSettings = normalizeNtfySettings(persistedNtfySettings);

    dom.manualNtfyScheduleButton.disabled = true;
    markNtfyScheduleChanged("manual_reconcile");
    emitNtfyDebugLog("manual_schedule_start", {
      traceId,
      topic: nextSettings.topic || "",
      events: String(state.events.length),
    });
    setAccountSettingsMessage("Scheduling all reminders now...");

    try {
      const scheduleResult = await enqueueNtfyOperation("manual_reconcile", () =>
        reconcileNtfyRemindersFull({
          eventsSnapshot: state.events,
          onProgress: ({ completed, total }) => {
            setAccountSettingsMessage(`Scheduling reminders... ${completed}/${total}`);
          },
          nextSettings,
          previousSettings,
        }),
      );
      ntfyScheduledViewCache = null;

      const rateLimitRemaining = getRateLimitRemainingMs();
      emitNtfyDebugLog("manual_schedule_done", {
        traceId,
        scheduled: String(scheduleResult.scheduled),
        failed: String(scheduleResult.failed),
        remainingRateLimitMs: String(rateLimitRemaining),
      });
      setAccountSettingsMessage(
        rateLimitRemaining > 0
          ? `Rate limited by the notification service. Partial sync complete; try again after ${formatRateLimitResumeTime()}.`
          : scheduleResult.failed
          ? `Manual run finished, but ${scheduleResult.failed} reminder${scheduleResult.failed === 1 ? "" : "s"} failed.`
          : `Manual run complete. ${scheduleResult.scheduled} reminder${
              scheduleResult.scheduled === 1 ? "" : "s"
            } scheduled.`,
        rateLimitRemaining > 0 || scheduleResult.failed ? "warning" : "success",
      );
    } catch (error) {
      console.error("Manual reminder scheduling failed", error);
      emitNtfyDebugLog("manual_schedule_error", {
        traceId,
        message: error?.message || "unknown error",
      });
      setAccountSettingsMessage("Could not complete manual scheduling. Check the browser console.", "warning");
    } finally {
      dom.manualNtfyScheduleButton.disabled = false;
    }
  }

  async function deleteEvent(eventId) {
    const eventToDelete = state.events.find((event) => event.id === eventId);

    if (eventToDelete) {
      markNtfyScheduleChanged("event_delete");
      await enqueueNtfyOperation("event_delete_cancel", () => cancelNtfyReminderStages(eventToDelete));
    }

    state.events = state.events.filter((event) => event.id !== eventId);
    await persistEvents();
    render();
    refreshActiveReminderSchedules();
  }

  async function setEventCompletion(eventId, isCompleted) {
    const userId = requireUserId();
    const targetEvent = state.events.find((event) => event.id === eventId);

    if (!userId || !targetEvent || targetEvent.type !== "deadline") {
      return;
    }

    const previousEvent = targetEvent;
    const completedAt = isCompleted ? new Date().toISOString() : "";
    const updatedEvents = state.events.map((event) => {
      if (event.id !== eventId) {
        return event;
      }

      return normalizeEvent({
        ...event,
        status: isCompleted ? "completed" : "open",
        completedAt,
      });
    });
    const nextEvents = sortEvents(updatedEvents);

    markNtfyScheduleChanged(isCompleted ? "deadline_complete" : "deadline_reopen");

    if (isCompleted) {
      await enqueueNtfyOperation("deadline_complete_cancel", () => cancelNtfyReminderStages(targetEvent));
    }

    state.events = nextEvents;
    if (!isCompleted) {
      void enqueueNtfyOperation("deadline_reopen_reconcile", () =>
        reconcileNtfyReminderForEvent({
          previousEvent,
          nextEvent: nextEvents.find((event) => event.id === eventId),
        }),
      ).catch((error) => {
        console.error("Failed to reconcile reminder after reopening deadline", error);
      });
    }
    render();
    refreshActiveReminderSchedules();

    try {
      await enqueueEventPersistence(nextEvents, userId);
    } catch (error) {
      console.error("Failed to update event completion", error);

      const currentEvent = state.events.find((event) => event.id === eventId);
      const isStillSameOptimisticUpdate =
        currentEvent?.status === (isCompleted ? "completed" : "open") &&
        (isCompleted ? currentEvent.completedAt === completedAt : !currentEvent.completedAt);

      if (isStillSameOptimisticUpdate) {
        state.events = sortEvents(
          state.events.map((event) => (event.id === eventId ? previousEvent : event)),
        );
        render();
      }
    }
  }

  async function deleteCourse(courseName) {
    const removedEvents = state.events.filter((event) => courseNameEquals(event.course, courseName));

    markNtfyScheduleChanged("course_delete");
    await enqueueNtfyOperation("course_delete_cancel", () => cancelNtfyReminderStagesForEvents(removedEvents));

    state.courses = state.courses.filter((course) => !courseNameEquals(getCourseName(course), courseName));
    state.events = state.events.filter((event) => !courseNameEquals(event.course, courseName));
    await persistCourses();
    await persistEvents();

    if (courseNameEquals(state.filters.course, courseName)) {
      state.filters.course = "all";
    }

    if (editingCourseOriginalName && courseNameEquals(editingCourseOriginalName, courseName)) {
      resetCourseFormEditor();
    }

    render();
    refreshActiveReminderSchedules();
    setCourseMessage(`${courseName} removed.`);
  }

  async function clearUserScheduleData() {
    markNtfyScheduleChanged("clear_data");
    await enqueueNtfyOperation("clear_data_cancel", () => cancelNtfyReminderStagesForEvents(state.events));
    state.events = [];
    state.courses = [];
    state.filters = { ...DEFAULT_FILTERS };
    resetCourseFormEditor();
    resetEditForm();
    await persistCourses();
    await persistEvents();
    render();
    refreshActiveReminderSchedules();
    setAccountSettingsMessage("All schedule data cleared.");
  }

  function handleFilterChange() {
    state.filters.type = dom.typeFilterSelect.value;
    state.filters.course = dom.courseFilterSelect.value;
    state.filters.status = dom.statusFilterSelect.value;
    render();
  }

  function clearFilters() {
    state.filters = { ...DEFAULT_FILTERS };
    render();
  }

  function consumeHashAction() {
    if (window.location.hash !== "#add" || state.bootstrapStatus !== "ready" || !state.user) {
      return;
    }

    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    openComposer();
  }

  function handleTimelineClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const editButton = event.target.closest("[data-edit-event-id]");

    if (editButton) {
      const eventId = editButton.dataset.editEventId;
      const eventToEdit = state.events.find((item) => item.id === eventId);
      openEdit(eventToEdit, editButton);
      return;
    }

    const completeButton = event.target.closest("[data-complete-event-id]");

    if (completeButton) {
      const eventId = completeButton.dataset.completeEventId;
      void setEventCompletion(eventId, true);
      return;
    }

    const reopenButton = event.target.closest("[data-reopen-event-id]");

    if (reopenButton) {
      const eventId = reopenButton.dataset.reopenEventId;
      void setEventCompletion(eventId, false);
      return;
    }

    const deleteButton = event.target.closest("[data-event-id]");

    if (!deleteButton) {
      return;
    }

    const eventId = deleteButton.dataset.eventId;
    const eventToDelete = state.events.find((item) => item.id === eventId);

    if (!eventToDelete) {
      return;
    }

    openConfirm({
      title: "Delete this event?",
      body: `${eventToDelete.event} for ${eventToDelete.course} will be removed from your calendar.`,
      action: () => deleteEvent(eventId),
    });
  }

  function handleCourseListClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const editButton = event.target.closest("[data-edit-course-name]");

    if (editButton) {
      const courseName = editButton.dataset.editCourseName;
      const course = getCourseBySelection(courseName);

      if (!course) {
        setCourseMessage("This course could not be found.", "warning");
        return;
      }

      editingCourseOriginalName = getCourseName(course);
      dom.courseNameInput.value = getCourseName(course);
      dom.courseDayInputs.forEach((input) => {
        input.checked = course.classDays.includes(input.value);
      });
      dom.courseStartTimeInput.value = course.startTime ?? "";
      dom.courseEndTimeInput.value = course.endTime ?? "";
      dom.courseSubmitButton.textContent = "Save course";
      dom.cancelCourseEditButton.classList.remove("is-hidden");
      setCourseMessage(`Editing ${getCourseName(course)}.`);
      dom.courseNameInput.focus();
      return;
    }

    const deleteButton = event.target.closest("[data-course-name]");

    if (!deleteButton) {
      return;
    }

    const courseName = deleteButton.dataset.courseName;
    const relatedEvents = state.events.filter((item) => courseNameEquals(item.course, courseName)).length;
    const details =
      relatedEvents > 0
        ? `This will also remove ${relatedEvents} scheduled item${relatedEvents === 1 ? "" : "s"}.`
        : "This course has no scheduled items right now.";

    openConfirm({
      title: "Remove this course?",
      body: `${courseName} will be removed from your enrolled courses. ${details}`,
      action: () => deleteCourse(courseName),
      confirmLabel: "Remove",
    });
  }

  function handleConfirmApprove() {
    if (confirmAction) {
      void Promise.resolve(confirmAction());
    }

    closeConfirm();
  }

  function handleAccountButtonClick() {
    openAccountSettings();
  }

  function handleClearDataClick() {
    openConfirm({
      title: "Clear all schedule data?",
      body: "This removes all courses and events from your account. Your account and semester settings stay in place.",
      action: () => clearUserScheduleData(),
      confirmLabel: "Clear Data",
    });
  }

  async function reauthenticateUser() {
    await sessionService.reauthenticateUser();
  }

  async function deleteCollectionRecursive(collectionRef) {
    await scheduleRepository.deleteCollectionRecursive(collectionRef);
  }

  async function deleteUserData(uid) {
    await scheduleRepository.deleteUserData(uid);
  }

  async function deleteAuthUser() {
    await sessionService.deleteAuthUser();
  }

  async function handleDeleteAccountConfirm() {
    if (!state.user?.id || isDeletingAccount || dom.deleteAccountConfirmInput.value.trim() !== "DELETE") {
      return;
    }

    isDeletingAccount = true;
    setDeleteAccountMessage("");
    syncDeleteAccountConfirmState();

    try {
      await reauthenticateUser();
    } catch (error) {
      console.error("Reauthentication failed", error);
      isDeletingAccount = false;
      syncDeleteAccountConfirmState();
      setDeleteAccountMessage("Please sign in again to continue");
      return;
    }

    try {
      await deleteUserData(state.user.id);
    } catch (error) {
      console.error("Failed to delete Firestore data", error);
      isDeletingAccount = false;
      syncDeleteAccountConfirmState();
      setDeleteAccountMessage("Failed to delete account. Try again.");
      return;
    }

    try {
      await deleteAuthUser();
      activeAuthSequence += 1;
      closeAllModals();
      resetScheduleState();
      resetSetupState();
      state.user = null;
      state.sessionStatus = "signed-out";
      state.bootstrapStatus = "ready";
      state.errorMessage = "";
      render();
    } catch (error) {
      console.error("Failed to delete auth user", error);
      isDeletingAccount = false;
      syncDeleteAccountConfirmState();
      setDeleteAccountMessage("Failed to delete account. Try again.");
    }
  }

  async function handleSessionActionClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const actionButton = event.target.closest("[data-auth-action]");

    if (!actionButton) {
      return;
    }

    event.preventDefault();
    const { authAction } = actionButton.dataset;

    try {
      if (authAction === "sign-in") {
        state.errorMessage = "";
        await sessionService.signIn();
        return;
      }

      if (authAction === "sign-out") {
        state.errorMessage = "";
        closeAllModals();
        await sessionService.signOut();
      }
    } catch (error) {
      console.error("Authentication action failed", error);
      state.errorMessage =
        typeof error?.code === "string"
          ? `Authentication failed (${error.code}).`
          : "Authentication failed. Please try again.";
      render();
    }
  }

  function handleKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (dom.deleteAccountModal.classList.contains("is-open")) {
      closeDeleteAccountModal();
      return;
    }

    if (dom.confirmModal.classList.contains("is-open")) {
      closeConfirm();
      return;
    }

    if (dom.accountModal.classList.contains("is-open")) {
      closeAccountSettings();
      return;
    }

    if (dom.editModal.classList.contains("is-open")) {
      closeEdit();
      return;
    }

    if (dom.coursesModal.classList.contains("is-open")) {
      closeCourses();
      return;
    }

    if (dom.composerModal.classList.contains("is-open")) {
      closeComposer();
    }
  }

  function initComposer() {
    dom.eventDateInput.value = formatDateValue(startOfToday());
    dom.eventTypeInputs.forEach((input) =>
      input.addEventListener("change", () => {
        syncComposerUI();
        validateComposerPresetDate();
      }),
    );
    dom.eventCourseSelect.addEventListener("change", () => {
      applyComposerCourseTimingPreset({ clearMessage: true });
      validateComposerPresetDate({ clearInvalidDate: true });
    });
    dom.eventDateInput.addEventListener("change", () => {
      validateComposerPresetDate({ clearInvalidDate: true });
    });
    dom.eventDeadlinePresetInputs.forEach((input) =>
      input.addEventListener("change", () => {
        if (getSelectedType() === "deadline") {
          syncDeadlinePresetSelection(dom.eventDeadlinePresetInputs, input);
        }

        applyComposerCourseTimingPreset({ clearMessage: true });
        validateComposerPresetDate({ clearInvalidDate: true });
      }),
    );
    dom.eventForm.addEventListener("submit", handleAddEvent);
    dom.openComposerButton.addEventListener("click", openComposer);
    dom.closeComposerButton.addEventListener("click", closeComposer);
    syncComposerUI();
  }

  function initCourses() {
    dom.openCoursesButton.addEventListener("click", openCourses);
    dom.closeCoursesButton.addEventListener("click", closeCourses);
    dom.courseForm.addEventListener("submit", handleAddCourse);
    dom.cancelCourseEditButton.addEventListener("click", () => {
      resetCourseFormEditor();
      setCourseMessage("Edit canceled.");
      dom.courseNameInput.focus();
    });
    dom.courseList.addEventListener("click", handleCourseListClick);
  }

  function initEdit() {
    dom.editEventTypeInputs.forEach((input) =>
      input.addEventListener("change", () => {
        syncEditUI();
        validateEditPresetDate();
      }),
    );
    dom.editEventCourseSelect.addEventListener("change", () => {
      applyEditCourseTimingPreset({ clearMessage: true });
      validateEditPresetDate({ clearInvalidDate: true });
    });
    dom.editEventDateInput.addEventListener("change", () => {
      validateEditPresetDate({ clearInvalidDate: true });
    });
    dom.editDeadlinePresetInputs.forEach((input) =>
      input.addEventListener("change", () => {
        if (getSelectedEditType() === "deadline") {
          syncDeadlinePresetSelection(dom.editDeadlinePresetInputs, input);
        }

        applyEditCourseTimingPreset({ clearMessage: true });
        validateEditPresetDate({ clearInvalidDate: true });
      }),
    );
    dom.editEventForm.addEventListener("submit", handleEditEvent);
    dom.closeEditButton.addEventListener("click", closeEdit);
    syncEditUI();
  }

  function initFilters() {
    dom.typeFilterSelect.addEventListener("change", handleFilterChange);
    dom.courseFilterSelect.addEventListener("change", handleFilterChange);
    dom.statusFilterSelect.addEventListener("change", handleFilterChange);
    dom.clearFiltersButton.addEventListener("click", clearFilters);
  }

  function initSidebarToggle() {
    if (!dom.sidebar || !dom.sidebarToggleButton) {
      return;
    }

    function setSidebarOpen(isOpen) {
      dom.sidebar.classList.toggle("is-open", isOpen);
      dom.sidebarToggleButton.setAttribute("aria-expanded", String(isOpen));
      dom.sidebarToggleButton.setAttribute("aria-label", isOpen ? "Close sidebar menu" : "Open sidebar menu");
    }

    setSidebarOpen(false);
    dom.sidebarToggleButton.addEventListener("click", () => {
      setSidebarOpen(!dom.sidebar.classList.contains("is-open"));
    });
  }

  function initLegendTooltips() {
    const tooltip = document.createElement("div");
    let activeChip = null;

    tooltip.className = "legend-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);

    function positionTooltip() {
      if (!activeChip) {
        return;
      }

      const chipRect = activeChip.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 10;
      const centeredLeft = chipRect.left + chipRect.width / 2 - tooltipRect.width / 2;
      const rowTolerance = 4;
      const chips = [...activeChip.parentElement.querySelectorAll(".legend-chip[data-tooltip]")];
      const activeIndex = chips.indexOf(activeChip);
      const isSameRow = (chip) => Math.abs(chip.getBoundingClientRect().top - chipRect.top) <= rowTolerance;
      const hasPreviousChipInRow = chips.slice(0, activeIndex).some(isSameRow);
      const hasNextChipInRow = chips.slice(activeIndex + 1).some(isSameRow);
      let rowAwareLeft = centeredLeft;

      if (!hasPreviousChipInRow) {
        rowAwareLeft = chipRect.left;
      } else if (!hasNextChipInRow) {
        rowAwareLeft = chipRect.right - tooltipRect.width;
      }

      const viewportMin = margin;
      const viewportMax = window.innerWidth - tooltipRect.width - margin;
      const left = Math.min(Math.max(rowAwareLeft, viewportMin), viewportMax);
      const belowTop = chipRect.bottom + 6;
      const aboveTop = chipRect.top - tooltipRect.height - 6;
      const maxTop = window.innerHeight - tooltipRect.height - margin;
      const top = belowTop <= maxTop ? belowTop : Math.max(margin, aboveTop);

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function showTooltip(chip) {
      const tooltipText = chip.dataset.tooltip;

      if (!tooltipText) {
        return;
      }

      activeChip = chip;
      tooltip.textContent = tooltipText;
      tooltip.classList.add("is-visible");
      positionTooltip();
    }

    function hideTooltip() {
      activeChip = null;
      tooltip.classList.remove("is-visible");
    }

    document.querySelectorAll(".legend-chip[data-tooltip]").forEach((chip) => {
      chip.addEventListener("mouseenter", () => showTooltip(chip));
      chip.addEventListener("focus", () => showTooltip(chip));
      chip.addEventListener("mouseleave", hideTooltip);
      chip.addEventListener("blur", hideTooltip);
    });

    window.addEventListener("resize", positionTooltip);
    document.addEventListener("scroll", positionTooltip, { capture: true, passive: true });
  }

  function initAccountSettings() {
    dom.accountButton.addEventListener("click", handleAccountButtonClick);
    dom.closeAccountButton.addEventListener("click", closeAccountSettings);
    dom.accountSettingsForm.addEventListener("submit", handleSaveAccountSettings);
    dom.accountSettingsForm.addEventListener("input", () => {
      state.ntfySettings = readAccountNtfySettings();
    });
    dom.accountSettingsForm.addEventListener("change", () => {
      state.ntfySettings = readAccountNtfySettings();
    });
    dom.copyNtfyTopicButton.addEventListener("click", () => {
      void copyNtfyTopic(dom.ntfyTopicInput);
    });
    dom.testNtfyButton.addEventListener("click", () => {
      state.ntfySettings = readAccountNtfySettings();
      void sendNtfyTest(state.ntfySettings);
    });
    dom.regenerateNtfyTopicButton.addEventListener("click", () => {
      void regenerateNtfyTopic();
    });
    dom.manualNtfyScheduleButton.addEventListener("click", () => {
      void handleManualNtfySchedule();
    });
    dom.viewScheduledNtfyButton.addEventListener("click", () => {
      void handleViewScheduledNtfy();
    });
    dom.clearDataButton.addEventListener("click", handleClearDataClick);
  }

  function initDeleteAccount() {
    dom.openDeleteAccountButton.addEventListener("click", openDeleteAccountModal);
    dom.deleteAccountCancelButton.addEventListener("click", closeDeleteAccountModal);
    dom.deleteAccountConfirmButton.addEventListener("click", () => {
      void handleDeleteAccountConfirm();
    });
    dom.deleteAccountConfirmInput.addEventListener("input", () => {
      setDeleteAccountMessage("");
      syncDeleteAccountConfirmState();
    });
  }

  function initConfirm() {
    dom.confirmCancelButton.addEventListener("click", closeConfirm);
    dom.confirmApproveButton.addEventListener("click", handleConfirmApprove);
  }

  function initSharedModalClose() {
    dom.sharedModalCloseElements.forEach((element) => {
      element.addEventListener("click", () => {
        const modalName = element.dataset.closeModal;

        if (modalName === "composer") {
          closeComposer();
        }

        if (modalName === "courses") {
          closeCourses();
        }

        if (modalName === "edit") {
          closeEdit();
        }

        if (modalName === "account") {
          closeAccountSettings();
        }

        if (modalName === "delete-account") {
          closeDeleteAccountModal();
        }
      });
    });
  }

  function initSetupFlow() {
    dom.authScreen.addEventListener("submit", (event) => {
      void handleSetupSubmit(event);
    });
    dom.authScreen.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (event.target.closest("#setupCopyNtfyTopicButton")) {
        void copyNtfyTopic(dom.authScreen.querySelector("#setupNtfyTopicInput"), setSetupMessage);
        return;
      }

      if (event.target.closest("#setupTestNtfyButton")) {
        state.ntfySettings = readSetupNtfySettings();
        void sendNtfyTest(state.ntfySettings, setSetupMessage);
        return;
      }

      if (event.target.closest("#setupRegenerateNtfyTopicButton")) {
        void regenerateNtfyTopic({ setup: true });
      }
    });
    dom.authScreen.addEventListener("input", () => {
      syncSetupDraftFromDom();
    });
    dom.authScreen.addEventListener("change", () => {
      syncSetupDraftFromDom();
    });
  }

  function initAuthSubscription() {
    sessionService.subscribe((user) => {
      handleAuthStateChange(user);
    });
  }

  function initNtfyReconciliation() {
    if (isBrowserReminderProviderActive()) {
      window.addEventListener("focus", () => {
        scheduleBrowserReminderTimers();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          scheduleBrowserReminderTimers();
        }
      });
      return;
    }

    window.addEventListener("focus", () => {
      requestNtfyReconcile();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        requestNtfyReconcile();
      }
    });
    window.setInterval(() => {
      requestNtfyReconcile();
    }, NTFY_RECONCILE_INTERVAL_MS);
  }

  return {
    init() {
      render();
      initComposer();
      initCourses();
      initEdit();
      initFilters();
      initSidebarToggle();
      initLegendTooltips();
      initAccountSettings();
      initDeleteAccount();
      initConfirm();
      initSharedModalClose();
      initSetupFlow();
      initNtfyReconciliation();
      initAuthSubscription();
      dom.examGrid.addEventListener("click", handleTimelineClick);
      window.addEventListener("hashchange", consumeHashAction);
      document.addEventListener("click", handleSessionActionClick, { capture: true });
      document.addEventListener("keydown", handleKeydown);
    },
  };
}
