import { DEFAULT_SEMESTER_LABEL } from "./js/config.js";
import { createFirestoreScheduleRepository } from "./js/repositories/firestoreScheduleRepository.js";
import { createFirebaseSessionService } from "./js/services/firebaseSessionService.js";
import {
  dateFormatter,
  daysUntil,
  escapeHtml,
  formatCountdown,
  formatDateValue,
  formatTimeValue,
  fullDateFormatter,
  getCountdownTone,
  groupEventsByDate,
  isEventCompleted,
  isEventOverdue,
  parseLocalDate,
  sortEvents,
  startOfToday,
  truncateText,
} from "./js/utils.js";

const calendarDom = {
  pageShell: document.querySelector(".page-shell"),
  authScreen: document.querySelector("#authScreen"),
  sidebar: document.querySelector(".sidebar"),
  sidebarToggleButton: document.querySelector("#sidebarToggleButton"),
  sidebarSemesterLabel: document.querySelector("#calendarSidebarSemesterLabel"),
  semesterLabel: document.querySelector("#calendarSemesterLabel"),
  semesterRange: document.querySelector("#calendarSemesterRange"),
  accountName: document.querySelector("#calendarAccountName"),
  typeFilterSelect: document.querySelector("#calendarTypeFilterSelect"),
  statusFilterSelect: document.querySelector("#calendarStatusFilterSelect"),
  clearFiltersButton: document.querySelector("#calendarClearFiltersButton"),
  title: document.querySelector("#calendarTitle"),
  viewKicker: document.querySelector("#calendarViewKicker"),
  rangeLabel: document.querySelector("#calendarRangeLabel"),
  pulseStats: document.querySelector("#calendarPulseStats"),
  stage: document.querySelector("#calendarStage"),
  focusPanel: document.querySelector("#calendarFocusPanel"),
  viewModeButtons: [...document.querySelectorAll("[data-view-mode]")],
  shiftButtons: [...document.querySelectorAll("[data-shift]")],
  todayButton: document.querySelector("[data-calendar-today]"),
};

const sessionService = createFirebaseSessionService();
const scheduleRepository = createFirestoreScheduleRepository();
const shortWeekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const compactMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const VIEW_LABELS = {
  month: "Month",
  week: "Week",
  day: "Day",
};

const DEFAULT_FILTERS = {
  status: "all",
  type: "all",
};

const state = {
  authInitialized: false,
  authSequence: 0,
  sessionStatus: "loading",
  bootstrapStatus: "loading",
  user: null,
  errorMessage: "",
  events: [],
  preferences: {
    semester: DEFAULT_SEMESTER_LABEL,
    startDate: "",
    endDate: "",
  },
  filters: { ...DEFAULT_FILTERS },
  viewMode: "month",
  cursorDate: startOfToday(),
  selectedDate: formatDateValue(startOfToday()),
};

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function addMonths(date, amount) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + amount, 1);
  return nextDate;
}

function startOfWeek(date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() - nextDate.getDay());
  return nextDate;
}

function endOfWeek(date) {
  const nextDate = startOfWeek(date);
  nextDate.setDate(nextDate.getDate() + 6);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function normalizeDateValue(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function formatSemesterRange(startDate, endDate) {
  const normalizedStart = normalizeDateValue(startDate);
  const normalizedEnd = normalizeDateValue(endDate);

  if (!normalizedStart || !normalizedEnd) {
    return "";
  }

  const start = normalizedStart > normalizedEnd ? normalizedEnd : normalizedStart;
  const end = normalizedStart > normalizedEnd ? normalizedStart : normalizedEnd;
  return `${compactMonthFormatter.format(parseLocalDate(start))} - ${compactMonthFormatter.format(
    parseLocalDate(end),
  )}`;
}

function setShellMode(mode) {
  calendarDom.pageShell.classList.toggle("is-auth-view", mode === "auth");
  calendarDom.pageShell.classList.toggle("is-app-view", mode === "app");
}

function setSemesterLabels() {
  const semester = state.preferences.semester || DEFAULT_SEMESTER_LABEL;
  calendarDom.sidebarSemesterLabel.textContent = semester;
  calendarDom.semesterLabel.textContent = semester;
  calendarDom.semesterRange.textContent = formatSemesterRange(state.preferences.startDate, state.preferences.endDate);
}

function renderAuthScreen(options) {
  const actionMarkup = options.action
    ? `
      <button class="google-signin-button auth-cta" type="button" data-auth-action="${escapeHtml(options.action.type)}">
        <span class="google-signin-icon" aria-hidden="true">
          <svg viewBox="0 0 18 18" role="presentation" focusable="false">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.56 2.68-3.86 2.68-6.62Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.98 10.72A5.41 5.41 0 0 1 3.7 9c0-.6.1-1.18.28-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.02-2.34Z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.36l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34c.7-2.12 2.68-3.7 5.02-3.7Z" />
          </svg>
        </span>
        <span>${escapeHtml(options.action.label)}</span>
      </button>
    `
    : "";

  calendarDom.authScreen.innerHTML = `
    <article class="auth-card auth-card-split">
      <section class="auth-panel auth-panel-main">
        <div class="auth-brand">
          <span class="auth-brand-mark" aria-hidden="true"></span>
          <span class="auth-brand-name">Exam Calendar</span>
        </div>
        <p class="auth-kicker">${escapeHtml(options.kicker)}</p>
        <h2>${escapeHtml(options.title)}</h2>
        <p class="auth-subtitle">${escapeHtml(options.subtitle)}</p>
        <p class="auth-body">${escapeHtml(options.body || "")}</p>
        ${actionMarkup}
      </section>
      <aside class="auth-panel auth-panel-detail" aria-label="Calendar preview">
        <p class="auth-panel-label">Time Atlas</p>
        <div class="auth-preview-list">
          <div class="auth-preview-item">
            <span class="auth-preview-title">Month pulse</span>
            <span class="auth-preview-copy">Stacked days and quiet gaps show up fast.</span>
          </div>
          <div class="auth-preview-item">
            <span class="auth-preview-title">Week zoom</span>
            <span class="auth-preview-copy">A tighter view for crowded exam runs.</span>
          </div>
          <div class="auth-preview-item">
            <span class="auth-preview-title">Day lens</span>
            <span class="auth-preview-copy">Times, courses, and notes land in one focused lane.</span>
          </div>
        </div>
      </aside>
    </article>
  `;
}

function renderWorkspaceMessage(options) {
  calendarDom.title.textContent = options.title;
  calendarDom.viewKicker.textContent = options.kicker;
  calendarDom.rangeLabel.textContent = "";
  calendarDom.pulseStats.innerHTML = "";
  calendarDom.stage.className = "calendar-stage message-mode is-live";
  calendarDom.stage.innerHTML = `
    <article class="calendar-empty-state">
      <p class="section-kicker">${escapeHtml(options.kicker)}</p>
      <h3>${escapeHtml(options.title)}</h3>
      <p>${escapeHtml(options.body)}</p>
      ${options.href ? `<a class="primary-button side-link" href="${escapeHtml(options.href)}">${escapeHtml(options.actionLabel)}</a>` : ""}
    </article>
  `;
  calendarDom.focusPanel.innerHTML = "";
}

function matchesStatusFilter(event) {
  if (state.filters.status === "completed") {
    return isEventCompleted(event);
  }

  if (state.filters.status === "overdue") {
    return isEventOverdue(event);
  }

  if (state.filters.status === "open") {
    return !isEventCompleted(event);
  }

  return true;
}

function getVisibleEvents() {
  return sortEvents(state.events).filter((event) => {
    const matchesType = state.filters.type === "all" || event.type === state.filters.type;
    return matchesType && matchesStatusFilter(event);
  });
}

function getEventsByDate(events = getVisibleEvents()) {
  return groupEventsByDate(events);
}

function chooseInitialDate(events) {
  const todayValue = formatDateValue(startOfToday());
  const upcoming = sortEvents(events).find(
    (event) => event.date >= todayValue && !isEventCompleted(event) && !isEventOverdue(event),
  );

  return upcoming?.date || todayValue;
}

function getEventTone(event) {
  if (isEventCompleted(event)) {
    return "completed";
  }

  if (isEventOverdue(event)) {
    return "overdue";
  }

  return getCountdownTone(event.date) || "calm";
}

function getDayTone(events) {
  if (!events.length) {
    return "";
  }

  if (events.every((event) => isEventCompleted(event))) {
    return "completed";
  }

  if (events.some((event) => isEventOverdue(event))) {
    return "overdue";
  }

  if (events.length > 1) {
    return "stacked";
  }

  return getCountdownTone(events[0].date);
}

function formatRangeLabel() {
  if (state.viewMode === "month") {
    return monthFormatter.format(state.cursorDate);
  }

  if (state.viewMode === "week") {
    const start = startOfWeek(state.cursorDate);
    const end = endOfWeek(state.cursorDate);
    return `${compactMonthFormatter.format(start)} - ${compactMonthFormatter.format(end)}`;
  }

  return fullDateFormatter.format(parseLocalDate(state.selectedDate));
}

function renderPulseStats(events) {
  const openCount = events.filter((event) => !isEventCompleted(event)).length;
  const stackedCount = [...getEventsByDate(events).values()].filter((items) => items.length > 1).length;
  const overdueCount = events.filter((event) => isEventOverdue(event)).length;

  calendarDom.pulseStats.innerHTML = `
    <span><strong>${String(openCount).padStart(2, "0")}</strong> open</span>
    <span><strong>${String(stackedCount).padStart(2, "0")}</strong> stacked</span>
    <span><strong>${String(overdueCount).padStart(2, "0")}</strong> overdue</span>
  `;
}

function renderEventPip(event, index) {
  return `
    <span class="atlas-event-pip ${escapeHtml(event.type)} ${escapeHtml(getEventTone(event))}" style="--pip-index: ${index}">
      ${escapeHtml(truncateText(event.course, 10))}
    </span>
  `;
}

function renderMonthDay(date, monthIndex, eventsByDate) {
  const dateValue = formatDateValue(date);
  const dayEvents = eventsByDate.get(dateValue) ?? [];
  const isOutsideMonth = date.getMonth() !== monthIndex;
  const isSelected = dateValue === state.selectedDate;
  const isToday = dateValue === formatDateValue(startOfToday());
  const tone = getDayTone(dayEvents);
  const countText = dayEvents.length ? `${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}` : "No items";
  const pips = dayEvents.slice(0, 3).map(renderEventPip).join("");

  return `
    <button
      class="atlas-day ${isOutsideMonth ? "is-outside" : ""} ${isSelected ? "is-selected" : ""} ${
        isToday ? "is-today" : ""
      } ${tone ? `is-${tone}` : ""}"
      type="button"
      data-date="${dateValue}"
      style="--heat: ${Math.min(dayEvents.length, 5)}"
      aria-label="${escapeHtml(`${fullDateFormatter.format(date)}. ${countText}.`)}"
    >
      <span class="atlas-day-topline">
        <span class="atlas-day-name">${escapeHtml(shortWeekdayFormatter.format(date))}</span>
        <span class="atlas-day-number">${date.getDate()}</span>
      </span>
      <span class="atlas-day-pips">${pips}</span>
      ${dayEvents.length > 3 ? `<span class="atlas-more-count">+${dayEvents.length - 3}</span>` : ""}
    </button>
  `;
}

function renderMonthView(events) {
  const eventsByDate = getEventsByDate(events);
  const monthStart = new Date(state.cursorDate.getFullYear(), state.cursorDate.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const monthIndex = state.cursorDate.getMonth();
  const weeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const weekStart = addDays(gridStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex));
    const weekEvents = days.flatMap((date) => eventsByDate.get(formatDateValue(date)) ?? []);

    return `
      <section class="atlas-week-row" style="--row-index: ${weekIndex}">
        <button class="week-zoom-button" type="button" data-week-start="${formatDateValue(weekStart)}">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h10m0 0-4-4m4 4-4 4" />
          </svg>
          <span>${weekEvents.length ? `${weekEvents.length} due` : "Week"}</span>
        </button>
        <div class="atlas-week-days">
          ${days.map((date) => renderMonthDay(date, monthIndex, eventsByDate)).join("")}
        </div>
      </section>
    `;
  });

  return `
    <div class="atlas-month-grid">
      ${weeks.join("")}
    </div>
  `;
}

function renderWeekView(events) {
  const eventsByDate = getEventsByDate(events);
  const weekStart = startOfWeek(state.cursorDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekMinHour = 8;
  const weekMaxHour = 24;
  const weekHours = Array.from({ length: weekMaxHour - weekMinHour + 1 }, (_, index) => weekMinHour + index);

  return `
    <div class="atlas-week-board">
      ${days
        .map((date, dayIndex) => {
          const dateValue = formatDateValue(date);
          const dayEvents = eventsByDate.get(dateValue) ?? [];
          const isSelected = dateValue === state.selectedDate;
          const tone = getDayTone(dayEvents);

          return `
            <section class="week-day-column ${isSelected ? "is-selected" : ""} ${tone ? `is-${tone}` : ""}" style="--day-index: ${dayIndex}">
              <button class="week-day-head" type="button" data-date="${dateValue}">
                <span>${escapeHtml(shortWeekdayFormatter.format(date))}</span>
                <strong>${date.getDate()}</strong>
              </button>
              <div class="week-day-stream">
                <div class="week-day-grid" aria-hidden="true">
                  ${weekHours.map(() => "<span></span>").join("")}
                </div>
                <div class="week-day-events">
                  ${dayEvents.map((event, index) => renderWeekTimedEvent(event, index, weekMinHour, weekMaxHour)).join("")}
                </div>
                ${
                  dayEvents.length
                    ? ""
                    : '<span class="quiet-day">Quiet</span>'
                }
              </div>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function timeToMinutes(timeValue = "") {
  const match = String(timeValue).match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return 12 * 60;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getEventRangeMinutes(event) {
  if (event.type === "deadline") {
    const dueMinutes = timeToMinutes(event.endTime || event.startTime);
    const startMinutes = Math.max(0, dueMinutes - 45);

    return {
      startMinutes,
      endMinutes: Math.max(dueMinutes, startMinutes + 1),
    };
  }

  const startMinutes = timeToMinutes(event.startTime || event.endTime);
  const endMinutes = Math.max(timeToMinutes(event.endTime || event.startTime), startMinutes + 45);

  return {
    startMinutes,
    endMinutes,
  };
}

function formatHourLabel(hour) {
  if (hour === 24) {
    return "12:00 AM";
  }

  return formatTimeValue(`${String(hour).padStart(2, "0")}:00`);
}

function renderTimelineEvent(event, index, minHour, maxHour) {
  const { startMinutes, endMinutes } = getEventRangeMinutes(event);
  const totalMinutes = Math.max((maxHour - minHour) * 60, 60);
  const rawTop = ((startMinutes - minHour * 60) / totalMinutes) * 100;
  const height = Math.max(4, ((endMinutes - startMinutes) / totalMinutes) * 100);
  const top = Math.min(Math.max(0, rawTop), 100 - height);

  return `
    <article
      class="day-timeline-event ${escapeHtml(event.type)} ${escapeHtml(getEventTone(event))}"
      style="--top: ${top}; --height: ${height}; --event-index: ${index}"
    >
      <span>${escapeHtml(event.displayTime || "Any time")}</span>
      <strong>${escapeHtml(event.course)}</strong>
      <small>${escapeHtml(event.event)}</small>
    </article>
  `;
}

function renderWeekTimedEvent(event, index, minHour, maxHour) {
  const { startMinutes, endMinutes } = getEventRangeMinutes(event);
  const totalMinutes = Math.max((maxHour - minHour) * 60, 60);
  const rawTop = ((startMinutes - minHour * 60) / totalMinutes) * 100;
  const height = Math.max(6, ((endMinutes - startMinutes) / totalMinutes) * 100);
  const top = Math.min(Math.max(0, rawTop), 100 - height);

  return `
    <article
      class="compact-event week-timed-event ${escapeHtml(event.type)} ${escapeHtml(getEventTone(event))}"
      style="--top: ${top}; --height: ${height}; --event-index: ${index}"
    >
      <span class="compact-event-type">${event.type === "deadline" ? "Deadline" : "Exam"}</span>
      <strong>${escapeHtml(event.course)}</strong>
      <span>${escapeHtml(truncateText(event.event, 24))}</span>
      <small>${escapeHtml(event.displayTime || "Time not set")}</small>
    </article>
  `;
}

function renderDayView(events) {
  const dayEvents = events.filter((event) => event.date === state.selectedDate);
  const eventHours = dayEvents.flatMap((event) => {
    const range = getEventRangeMinutes(event);

    return [
      Math.floor(range.startMinutes / 60),
      Math.ceil(range.endMinutes / 60),
    ];
  });
  const minHour = Math.min(8, ...eventHours);
  const maxHour = Math.min(24, Math.max(22, ...eventHours, minHour + 2));
  const hours = Array.from({ length: maxHour - minHour + 1 }, (_, index) => minHour + index);

  return `
    <div class="day-lens">
      <div class="day-hour-rail" aria-hidden="true">
        ${hours.map((hour) => `<span>${escapeHtml(formatHourLabel(hour))}</span>`).join("")}
      </div>
      <div class="day-timeline">
        <div class="day-timeline-grid" aria-hidden="true">
          ${hours.map(() => "<span></span>").join("")}
        </div>
        <div class="day-timeline-events">
          ${
            dayEvents.length
              ? dayEvents.map((event, index) => renderTimelineEvent(event, index, minHour, maxHour)).join("")
              : '<div class="day-lens-empty">No items on this day.</div>'
          }
        </div>
      </div>
    </div>
  `;
}

function renderFocusPanel(events) {
  const selectedEvents = events.filter((event) => event.date === state.selectedDate);
  const countdown = formatCountdown(daysUntil(state.selectedDate));
  const selectedDate = parseLocalDate(state.selectedDate);

  calendarDom.focusPanel.innerHTML = `
    <div class="focus-date-lockup">
      <p class="section-kicker">Day Lens</p>
      <h2>
        <span>${escapeHtml(shortWeekdayFormatter.format(selectedDate))}</span>
        <span>${selectedDate.getDate()}</span>
      </h2>
      <span>${escapeHtml(countdown)}</span>
    </div>
    <div class="focus-event-list">
      ${
        selectedEvents.length
          ? selectedEvents.map(renderFocusEvent).join("")
          : '<article class="focus-event is-empty"><strong>No items here.</strong><span>Pick another date or zoom back out.</span></article>'
      }
    </div>
  `;
}

function renderFocusEvent(event, index) {
  const tone = getEventTone(event);

  return `
    <article class="focus-event ${escapeHtml(event.type)} ${escapeHtml(tone)}" style="--event-index: ${index}">
      <span class="focus-event-kind">${event.type === "deadline" ? "Deadline" : "Exam"}</span>
      <strong>${escapeHtml(event.course)}</strong>
      <span>${escapeHtml(event.event)}</span>
      <small>${escapeHtml(event.displayTime || "Time not set")}</small>
      ${event.notes ? `<em>${escapeHtml(event.notes)}</em>` : ""}
    </article>
  `;
}

function renderCalendar() {
  const events = getVisibleEvents();

  calendarDom.title.textContent = "Time Atlas";
  calendarDom.accountName.textContent = truncateText(state.user?.displayName || "Signed in", 28);
  calendarDom.typeFilterSelect.value = state.filters.type;
  calendarDom.statusFilterSelect.value = state.filters.status;
  calendarDom.clearFiltersButton.disabled =
    state.filters.type === DEFAULT_FILTERS.type && state.filters.status === DEFAULT_FILTERS.status;
  calendarDom.viewModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.viewMode === state.viewMode));
  });

  calendarDom.viewKicker.textContent = VIEW_LABELS[state.viewMode];
  calendarDom.rangeLabel.textContent = formatRangeLabel();
  renderPulseStats(events);

  const markup =
    state.viewMode === "week"
      ? renderWeekView(events)
      : state.viewMode === "day"
        ? renderDayView(events)
        : renderMonthView(events);

  calendarDom.stage.className = `calendar-stage ${state.viewMode}-mode`;
  calendarDom.stage.innerHTML = markup;
  calendarDom.stage.getBoundingClientRect();
  calendarDom.stage.classList.add("is-live");
  renderFocusPanel(events);
}

function render() {
  setSemesterLabels();

  if (!state.authInitialized) {
    setShellMode("auth");
    renderAuthScreen({
      kicker: "Loading",
      title: "Opening the atlas",
      subtitle: "Checking your session.",
      body: "This takes a second the first time.",
    });
    return;
  }

  if (state.sessionStatus === "signed-out" || !state.user) {
    setShellMode("auth");
    renderAuthScreen({
      kicker: "Sign In",
      title: "Open your Time Atlas",
      subtitle: "A zoomable calendar for exam season.",
      body: state.errorMessage || "",
      action: {
        type: "sign-in",
        label: "Sign in with Google",
      },
    });
    return;
  }

  setShellMode("app");

  if (state.bootstrapStatus === "loading") {
    renderWorkspaceMessage({
      kicker: "Loading",
      title: "Loading calendar",
      body: "Fetching your schedule.",
    });
    return;
  }

  if (state.bootstrapStatus === "setup") {
    renderWorkspaceMessage({
      kicker: "Setup",
      title: "Finish setup first",
      body: "Your calendar opens after the dashboard setup is complete.",
      href: "./index.html",
      actionLabel: "Dashboard",
    });
    return;
  }

  if (state.bootstrapStatus === "error") {
    renderWorkspaceMessage({
      kicker: "Error",
      title: "Could not load schedule",
      body: state.errorMessage || "Try refreshing the page.",
    });
    return;
  }

  renderCalendar();
}

async function bootstrapAuthenticatedUser(user) {
  const authSequence = ++state.authSequence;
  state.user = user;
  state.sessionStatus = user ? "signed-in" : "signed-out";
  state.errorMessage = "";

  if (!user?.id) {
    state.bootstrapStatus = "ready";
    render();
    return;
  }

  state.bootstrapStatus = "loading";
  render();

  try {
    const setupState = await scheduleRepository.checkUserSetupState(user.id);

    if (authSequence !== state.authSequence) {
      return;
    }

    if (!setupState?.hasCompletedSetup) {
      state.bootstrapStatus = "setup";
      render();
      return;
    }

    const schedule = await scheduleRepository.loadSchedule(user.id);

    if (authSequence !== state.authSequence) {
      return;
    }

    state.events = sortEvents(schedule.events);
    state.preferences = {
      semester: schedule.preferences?.semester || DEFAULT_SEMESTER_LABEL,
      startDate: schedule.preferences?.startDate || "",
      endDate: schedule.preferences?.endDate || "",
    };

    const focusDate = chooseInitialDate(state.events);
    state.cursorDate = parseLocalDate(focusDate);
    state.selectedDate = focusDate;
    state.bootstrapStatus = "ready";
    render();
  } catch (error) {
    if (authSequence !== state.authSequence) {
      return;
    }

    console.error("Failed to load calendar schedule", error);
    state.bootstrapStatus = "error";
    state.errorMessage = "The app could not load this calendar.";
    render();
  }
}

function shiftCalendar(direction) {
  const amount = Number(direction);

  if (state.viewMode === "month") {
    state.cursorDate = addMonths(state.cursorDate, amount);
    state.selectedDate = formatDateValue(state.cursorDate);
  } else if (state.viewMode === "week") {
    state.cursorDate = addDays(state.cursorDate, amount * 7);
    state.selectedDate = formatDateValue(state.cursorDate);
  } else {
    state.cursorDate = addDays(state.cursorDate, amount);
    state.selectedDate = formatDateValue(state.cursorDate);
  }

  render();
}

function setSelectedDate(dateValue, nextViewMode = state.viewMode) {
  state.selectedDate = dateValue;
  state.cursorDate = parseLocalDate(dateValue);
  state.viewMode = nextViewMode;
  render();
}

function initSidebarToggle() {
  function setSidebarOpen(isOpen) {
    calendarDom.sidebar.classList.toggle("is-open", isOpen);
    calendarDom.sidebarToggleButton.setAttribute("aria-expanded", String(isOpen));
    calendarDom.sidebarToggleButton.setAttribute("aria-label", isOpen ? "Close sidebar menu" : "Open sidebar menu");
  }

  setSidebarOpen(false);
  calendarDom.sidebarToggleButton.addEventListener("click", () => {
    setSidebarOpen(!calendarDom.sidebar.classList.contains("is-open"));
  });
}

function initCalendarControls() {
  calendarDom.viewModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.viewMode = button.dataset.viewMode || "month";
      state.cursorDate = parseLocalDate(state.selectedDate);
      render();
    });
  });

  calendarDom.shiftButtons.forEach((button) => {
    button.addEventListener("click", () => {
      shiftCalendar(button.dataset.shift);
    });
  });

  calendarDom.todayButton.addEventListener("click", () => {
    setSelectedDate(formatDateValue(startOfToday()), state.viewMode);
  });

  calendarDom.stage.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const weekButton = event.target.closest("[data-week-start]");

    if (weekButton) {
      setSelectedDate(weekButton.dataset.weekStart, "week");
      return;
    }

    const dayButton = event.target.closest("[data-date]");

    if (!dayButton) {
      return;
    }

    setSelectedDate(dayButton.dataset.date, "day");
  });
}

function initFilters() {
  function handleFilterChange() {
    state.filters.type = calendarDom.typeFilterSelect.value;
    state.filters.status = calendarDom.statusFilterSelect.value;
    render();
  }

  calendarDom.typeFilterSelect.addEventListener("change", handleFilterChange);
  calendarDom.statusFilterSelect.addEventListener("change", handleFilterChange);
  calendarDom.clearFiltersButton.addEventListener("click", () => {
    state.filters = { ...DEFAULT_FILTERS };
    render();
  });
}

function initAuth() {
  sessionService.subscribe((user) => {
    state.authInitialized = true;
    void bootstrapAuthenticatedUser(user);
  });

  document.addEventListener(
    "click",
    async (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const actionButton = event.target.closest("[data-auth-action]");

      if (!actionButton) {
        return;
      }

      event.preventDefault();
      const action = actionButton.dataset.authAction;

      try {
        if (action === "sign-in") {
          state.errorMessage = "";
          await sessionService.signIn();
          return;
        }

        if (action === "sign-out") {
          state.errorMessage = "";
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
    },
    { capture: true },
  );
}

render();
initSidebarToggle();
initCalendarControls();
initFilters();
initAuth();
