import {
  COURSE_DAY_OPTIONS,
  courseNameEquals,
  dateFormatter,
  daysUntil,
  escapeHtml,
  formatCountdown,
  formatCourseSchedule,
  fullDateFormatter,
  getCountdownTone,
  getCourseName,
  groupEventsByDate,
  parseLocalDate,
  sortEvents,
  truncateText,
} from "./utils.js";
import { DEFAULT_SEMESTER_LABEL } from "./config.js";

function hasActiveFilters(filters) {
  return filters.type !== "all" || filters.course !== "all";
}

function applyFilters(events, filters) {
  return events.filter((event) => {
    const matchesType = filters.type === "all" || event.type === filters.type;
    const matchesCourse = filters.course === "all" || event.course === filters.course;
    return matchesType && matchesCourse;
  });
}

function setShellMode(dom, mode) {
  dom.pageShell.classList.toggle("is-auth-view", mode === "auth");
  dom.pageShell.classList.toggle("is-setup-view", mode === "setup");
  dom.pageShell.classList.toggle("is-app-view", mode === "app");
}

function setAccountState(dom, state) {
  if (!dom.accountButton || !dom.accountName || !dom.accountHint) {
    return;
  }

  if (state === "disabled") {
    dom.accountButton.disabled = true;
    delete dom.accountButton.dataset.authAction;
    dom.accountName.textContent = "Account";
    dom.accountHint.textContent = "Sign in required";
    return;
  }

  dom.accountButton.disabled = false;
  delete dom.accountButton.dataset.authAction;
  dom.accountName.textContent = state.displayName;
  dom.accountHint.textContent = "Account settings";
}

function renderSemesterLabels(dom, semesterLabel) {
  const normalizedSemester =
    typeof semesterLabel === "string" && semesterLabel.trim()
      ? semesterLabel.trim()
      : DEFAULT_SEMESTER_LABEL;

  if (dom.sidebarSemesterLabel) {
    dom.sidebarSemesterLabel.textContent = normalizedSemester;
  }

  if (dom.heroSemesterLabel) {
    dom.heroSemesterLabel.textContent = normalizedSemester;
  }
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

  const semesterDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${semesterDateFormatter.format(parseLocalDate(start))} - ${semesterDateFormatter.format(
    parseLocalDate(end),
  )}`;
}

function renderSemesterRange(dom, startDate, endDate) {
  const rangeText = formatSemesterRange(startDate, endDate);

  if (dom.sidebarSemesterRange) {
    dom.sidebarSemesterRange.textContent = rangeText;
  }

  if (dom.heroSemesterRange) {
    dom.heroSemesterRange.textContent = rangeText;
  }
}

function renderAuthScreen(dom, options) {
  const hasGoogleAction = options.action?.type === "sign-in";
  const actionMarkup = options.action
    ? hasGoogleAction
      ? `
        <button class="google-signin-button auth-cta" type="button" data-auth-action="${escapeHtml(options.action.type)}">
          <span class="google-signin-icon" aria-hidden="true">
            <svg viewBox="0 0 18 18" role="presentation" focusable="false">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.56 2.68-3.86 2.68-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.98 10.72A5.41 5.41 0 0 1 3.7 9c0-.6.1-1.18.28-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.02-2.34Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.46 3.44 1.36l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34c.7-2.12 2.68-3.7 5.02-3.7Z"
              />
            </svg>
          </span>
          <span>${escapeHtml(options.action.label)}</span>
        </button>
      `
      : `<button class="primary-button auth-cta" type="button" data-auth-action="${escapeHtml(options.action.type)}">${escapeHtml(
          options.action.label,
        )}</button>`
    : "";
  const supportPanelMarkup = hasGoogleAction
    ? `
      <aside class="auth-panel auth-panel-detail" aria-label="What you can do after signing in">
        <p class="auth-panel-label">In one place</p>
        <div class="auth-preview-list">
          <div class="auth-preview-item">
            <span class="auth-preview-title">Upcoming exams</span>
            <span class="auth-preview-copy">See the next test, due date, or stacked day at a glance.</span>
          </div>
          <div class="auth-preview-item">
            <span class="auth-preview-title">Course timing</span>
            <span class="auth-preview-copy">Reuse class schedules so exam entries are faster to create.</span>
          </div>
          <div class="auth-preview-item">
            <span class="auth-preview-title">Private sync</span>
            <span class="auth-preview-copy">Your schedule loads with your Google account and stays tied to you.</span>
          </div>
        </div>
      </aside>
    `
    : "";
  const cardClassName = hasGoogleAction ? "auth-card auth-card-split" : "auth-card";

  dom.authScreen.innerHTML = `
    <article class="${cardClassName}">
      <section class="auth-panel auth-panel-main">
        <div class="auth-brand">
          <span class="auth-brand-mark" aria-hidden="true"></span>
          <span class="auth-brand-name">Exam Calendar</span>
        </div>
        <p class="auth-kicker">${escapeHtml(options.kicker)}</p>
        <h2>${escapeHtml(options.title)}</h2>
        <p class="auth-subtitle">${escapeHtml(options.subtitle)}</p>
        <p class="auth-body">${escapeHtml(options.body)}</p>
        ${actionMarkup}
        ${hasGoogleAction ? '<p class="auth-footnote">Use your Google account to open your personal schedule.</p>' : ""}
      </section>
      ${supportPanelMarkup}
    </article>
  `;
}

function renderSetupScreen(dom, setupState = {}) {
  const daysMarkup = COURSE_DAY_OPTIONS.map(
    (day) => `
      <label class="weekday-option">
        <input
          type="checkbox"
          name="setup_course_day"
          value="${escapeHtml(day.code)}"
          ${setupState.courseDays?.includes(day.code) ? "checked" : ""}
        />
        <span>${escapeHtml(day.label)}</span>
      </label>
    `,
  ).join("");

  const messageToneMarkup = setupState.message
    ? ` data-tone="${escapeHtml(setupState.messageTone || "warning")}"`
    : "";

  dom.authScreen.innerHTML = `
    <section class="setup-shell" aria-live="polite">
      <form id="setupForm" class="setup-card" novalidate>
        <div class="setup-header">
          <p class="auth-kicker">Setup</p>
          <h1>Set up your calendar</h1>
        </div>

        <div class="setup-grid">
          <label class="field field-wide">
            <span>Semester label</span>
            <input
              id="setupSemesterLabelInput"
              name="setup_semester_label"
              type="text"
              maxlength="40"
              placeholder="Fall 2026"
              value="${escapeHtml(setupState.semesterLabel || "")}"
              ${setupState.isSubmitting ? "disabled" : ""}
              required
            />
          </label>

          <label class="field">
            <span>Semester start date</span>
            <input
              id="setupSemesterStartInput"
              name="setup_semester_start"
              type="date"
              value="${escapeHtml(setupState.semesterStart || "")}"
              ${setupState.isSubmitting ? "disabled" : ""}
            />
          </label>

          <label class="field">
            <span>Semester end date</span>
            <input
              id="setupSemesterEndInput"
              name="setup_semester_end"
              type="date"
              value="${escapeHtml(setupState.semesterEnd || "")}"
              ${setupState.isSubmitting ? "disabled" : ""}
            />
          </label>
        </div>

        <section class="setup-section" aria-labelledby="setupCourseHeading">
          <div class="setup-section-header">
            <h2 id="setupCourseHeading">Add your first course (optional but recommended)</h2>
          </div>

          <div class="setup-grid">
            <label class="field field-wide">
              <span>Course name</span>
              <input
                id="setupCourseNameInput"
                name="setup_course_name"
                type="text"
                placeholder="Chem 101"
                value="${escapeHtml(setupState.courseName || "")}"
                ${setupState.isSubmitting ? "disabled" : ""}
              />
            </label>

            <div class="field field-wide">
              <span>Days</span>
              <div class="weekday-grid" role="group" aria-label="Setup course days Monday through Friday">
                ${daysMarkup}
              </div>
            </div>

            <label class="field">
              <span>Start time</span>
              <input
                id="setupCourseStartTimeInput"
                name="setup_course_start_time"
                type="time"
                value="${escapeHtml(setupState.courseStartTime || "")}"
                ${setupState.isSubmitting ? "disabled" : ""}
              />
            </label>

            <label class="field">
              <span>End time</span>
              <input
                id="setupCourseEndTimeInput"
                name="setup_course_end_time"
                type="time"
                value="${escapeHtml(setupState.courseEndTime || "")}"
                ${setupState.isSubmitting ? "disabled" : ""}
              />
            </label>
          </div>
        </section>

        <div class="setup-actions">
          <button id="setupContinueButton" class="primary-button setup-submit" type="submit" ${
            setupState.isSubmitting ? "disabled" : ""
          }>
            ${setupState.isSubmitting ? "Saving..." : "Continue"}
          </button>
          <p id="setupMessage" class="form-message"${messageToneMarkup}>${escapeHtml(setupState.message || "")}</p>
        </div>
      </form>
    </section>
  `;
}

function renderCourseFilterSelect(dom, courses, selectedCourse) {
  const courseNames = courses.map((course) => getCourseName(course)).filter(Boolean);

  dom.courseFilterSelect.innerHTML = `
    <option value="all">All courses</option>
    ${courseNames
      .map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`)
      .join("")}
  `;
  dom.courseFilterSelect.value = courseNames.includes(selectedCourse) ? selectedCourse : "all";
}

function renderCourseSelectElement(selectElement, courses, emptyLabel) {
  if (!selectElement) {
    return;
  }

  const courseNames = courses.map((course) => getCourseName(course)).filter(Boolean);
  const currentValue = selectElement.value;

  if (!courseNames.length) {
    selectElement.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
    selectElement.value = "";
    selectElement.disabled = true;
    return;
  }

  selectElement.innerHTML = `
    <option value="" disabled>Select a course</option>
    ${courseNames.map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("")}
  `;
  selectElement.disabled = false;

  if (currentValue && courseNames.includes(currentValue)) {
    selectElement.value = currentValue;
    return;
  }

  selectElement.value = courseNames[0];
}

function renderCourseSelect(dom, courses) {
  renderCourseSelectElement(dom.eventCourseSelect, courses, "Add a course first");
  renderCourseSelectElement(dom.editEventCourseSelect, courses, "No courses available");
}

function renderCourseList(dom, courses, events) {
  if (!courses.length) {
    dom.courseList.innerHTML = `
      <div class="empty-card">
        <p class="empty-card-title">No courses yet.</p>
        <p class="empty-card-text">Add your first course to start creating events.</p>
      </div>
    `;
    return;
  }

  dom.courseList.innerHTML = courses
    .map((course) => {
      const courseName = getCourseName(course);
      const eventCount = events.filter((event) => courseNameEquals(event.course, courseName)).length;
      const countLabel = `${eventCount} item${eventCount === 1 ? "" : "s"}`;
      const scheduleLabel = formatCourseSchedule(course);

      return `
        <article class="course-row">
          <div>
            <h3 class="course-row-title">${escapeHtml(courseName)}</h3>
            <p class="course-row-meta">${countLabel} in the schedule</p>
            <p class="course-row-meta">${escapeHtml(scheduleLabel)}</p>
          </div>
          <div class="course-row-actions">
            <button class="edit-button" type="button" data-edit-course-name="${escapeHtml(courseName)}">
              Edit
            </button>
            <button class="delete-button" type="button" data-course-name="${escapeHtml(courseName)}">
              Remove
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderNextEvent(dom, events) {
  const upcoming = events.find(({ date }) => daysUntil(date) >= 0);

  if (!upcoming) {
    dom.nextExamCard.innerHTML = `
      <div class="next-exam-content">
        <h2 class="next-title">Nothing upcoming</h2>
        <p class="next-details">No exams or deadlines in this view.</p>
      </div>
    `;
    return;
  }

  const daysRemaining = daysUntil(upcoming.date);
  const countdown = formatCountdown(daysRemaining);
  const statusText = escapeHtml(truncateText(upcoming.notes));
  const detailsLine = `${dateFormatter.format(parseLocalDate(upcoming.date))} • ${escapeHtml(
    upcoming.course,
  )} • ${escapeHtml(upcoming.displayTime)}`;
  const summaryLine = statusText
    ? `<p class="next-summary"><span class="next-summary-strong">${countdown}</span> • ${statusText}</p>`
    : `<p class="next-summary"><span class="next-summary-strong">${countdown}</span></p>`;

  dom.nextExamCard.innerHTML = `
    <div class="next-exam-content">
      <h2 class="next-title">${escapeHtml(upcoming.event)}</h2>
      <p class="next-details">${detailsLine}</p>
      ${summaryLine}
    </div>
  `;
}

function renderStats(dom, events, groupedEntries) {
  const allDates = events.map(({ date }) => daysUntil(date));
  const remainingDates = allDates.filter((days) => days >= 0);
  const uniqueCourses = new Set(events.map(({ course }) => course));
  const conflictDays = groupedEntries.filter(([, items]) => items.length > 1);

  dom.totalEvents.textContent = String(events.length).padStart(2, "0");
  dom.scheduleSpan.textContent = remainingDates.length
    ? String(Math.max(...remainingDates)).padStart(2, "0")
    : "00";
  dom.conflictCount.textContent = String(conflictDays.length).padStart(2, "0");
  dom.courseCount.textContent = String(uniqueCourses.size).padStart(2, "0");
}

function renderTimeline(dom, groupedEntries, filters) {
  if (!groupedEntries.length) {
    dom.examGrid.innerHTML = `
      <article class="exam-card">
        <div class="empty-board">
          <p class="section-kicker">${hasActiveFilters(filters) ? "No Matches" : "No Events Yet"}</p>
          <h3 class="empty-board-title">${
            hasActiveFilters(filters) ? "No items match these filters." : "Add your first exam or deadline."
          }</h3>
          <p class="empty-board-text">${
            hasActiveFilters(filters)
              ? "Try a different type or course, or clear the filters."
              : "Use the Add item button to build your schedule."
          }</p>
        </div>
      </article>
    `;
    return;
  }

  dom.examGrid.innerHTML = groupedEntries
    .map(([date, events], index) => {
      const countdownDays = daysUntil(date);
      const countdownText = formatCountdown(countdownDays);
      const dayHasConflict = events.length > 1;
      const tone = getCountdownTone(countdownDays, dayHasConflict);
      const dayLabel = dateFormatter.format(parseLocalDate(date));

      return `
        <article class="exam-card ${tone} ${dayHasConflict ? "has-conflict" : ""}" style="animation-delay: ${
          index * 70
        }ms">
          <div class="day-header">
            <div class="exam-date-group">
              <p class="exam-day">${dayLabel}</p>
              <span class="exam-date-text">${fullDateFormatter.format(parseLocalDate(date))}</span>
            </div>
            <span class="day-countdown ${tone}">${countdownText}</span>
          </div>

          <div class="events-stack">
            ${events
              .map(
                (event) => `
                  <article class="event-item">
                    <div class="event-head">
                      <h3 class="course-name">${escapeHtml(event.course)}</h3>
                      <div class="event-actions">
                        <span class="badge ${event.type}">${event.type === "deadline" ? "Deadline" : "Exam"}</span>
                        <button class="edit-button" type="button" data-edit-event-id="${escapeHtml(event.id)}">
                          Edit
                        </button>
                        <button class="delete-button" type="button" data-event-id="${escapeHtml(event.id)}">
                          Delete
                        </button>
                      </div>
                    </div>
                    <div class="event-meta">
                      <span class="event-name">${escapeHtml(event.event)}</span>
                      <span class="event-time">${escapeHtml(event.displayTime)}</span>
                    </div>
                    ${
                      event.notes
                        ? `<div class="event-note"><span class="note-pill">${escapeHtml(event.notes)}</span></div>`
                        : ""
                    }
                  </article>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function disableAuthenticatedControls(dom) {
  renderCourseSelect(dom, []);
  renderCourseList(dom, [], []);
  renderCourseFilterSelect(dom, [], "all");
  dom.typeFilterSelect.value = "all";
  dom.typeFilterSelect.disabled = true;
  dom.courseFilterSelect.disabled = true;
  dom.clearFiltersButton.disabled = true;
  if (dom.editEventCourseSelect) {
    dom.editEventCourseSelect.disabled = true;
  }
  dom.openComposerButton.disabled = true;
  dom.openCoursesButton.disabled = true;
}

function renderWorkspaceMessage(dom, options) {
  dom.nextExamCard.innerHTML = `
    <div class="next-exam-content">
      <h2 class="next-title">${escapeHtml(options.title)}</h2>
      <p class="next-details">${escapeHtml(options.subtitle)}</p>
    </div>
  `;

  dom.totalEvents.textContent = "00";
  dom.scheduleSpan.textContent = "00";
  dom.conflictCount.textContent = "00";
  dom.courseCount.textContent = "00";

  dom.examGrid.innerHTML = `
    <article class="exam-card">
      <div class="empty-board">
        <p class="section-kicker">${escapeHtml(options.kicker)}</p>
        <h3 class="empty-board-title">${escapeHtml(options.title)}</h3>
        <p class="empty-board-text">${escapeHtml(options.body)}</p>
      </div>
    </article>
  `;

  disableAuthenticatedControls(dom);
}

export function renderApp({ dom, state }) {
  renderSemesterLabels(dom, state.preferences?.semester);
  renderSemesterRange(dom, state.preferences?.startDate, state.preferences?.endDate);

  if (!state.authInitialized) {
    setShellMode(dom, "auth");
    renderAuthScreen(dom, {
      kicker: "Loading",
      title: "Preparing your workspace",
      subtitle: "Checking your Firebase session.",
      body: "This takes a second the first time.",
    });
    setAccountState(dom, "disabled");
    return;
  }

  if (state.sessionStatus === "signed-out" || !state.user) {
    setShellMode(dom, "auth");
    renderAuthScreen(dom, {
      kicker: "Sign In",
      title: "Welcome to Exam Calendar",
      subtitle: "A focused planner for exam season.",
      body: state.errorMessage || "",
      action: {
        type: "sign-in",
        label: "Sign in with Google",
      },
    });
    setAccountState(dom, "disabled");
    return;
  }

  if (state.bootstrapStatus === "setup") {
    setShellMode(dom, "setup");
    renderSetupScreen(dom, state.setup);
    setAccountState(dom, {
      displayName: truncateText(state.user.displayName || "Signed in", 28),
    });
    return;
  }

  setShellMode(dom, "app");
  setAccountState(dom, {
    displayName: truncateText(state.user.displayName || "Signed in", 28),
  });

  if (state.bootstrapStatus === "loading") {
    renderWorkspaceMessage(dom, {
      kicker: "Loading",
      title: "Loading your schedule",
      subtitle: "Fetching your events and courses.",
      body: "Please wait while your account data syncs.",
    });
    return;
  }

  if (state.bootstrapStatus === "error") {
    renderWorkspaceMessage(dom, {
      kicker: "Error",
      title: "Could not load schedule",
      subtitle: "There was a problem fetching your account data.",
      body: state.errorMessage || "Try refreshing the page.",
    });
    return;
  }

  const sortedEvents = sortEvents(state.events);
  const filteredEvents = applyFilters(sortedEvents, state.filters);
  const groupedEntries = [...groupEventsByDate(filteredEvents).entries()];

  renderNextEvent(dom, filteredEvents);
  renderStats(dom, filteredEvents, groupedEntries);
  renderTimeline(dom, groupedEntries, state.filters);
  renderCourseSelect(dom, state.courses);
  renderCourseList(dom, state.courses, state.events);
  renderCourseFilterSelect(dom, state.courses, state.filters.course);

  dom.typeFilterSelect.value = state.filters.type;
  dom.typeFilterSelect.disabled = false;
  dom.courseFilterSelect.disabled = false;
  dom.clearFiltersButton.disabled = !hasActiveFilters(state.filters);
  dom.openComposerButton.disabled = false;
  dom.openCoursesButton.disabled = false;
}
