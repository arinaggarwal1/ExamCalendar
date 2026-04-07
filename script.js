const EVENTS_STORAGE_KEY = "exam-calendar-events";
const COURSES_STORAGE_KEY = "exam-calendar-courses";
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const SAME_DAY_NOTE = "Multiple events on same day";
const LEGACY_SAME_DAY_NOTES = new Set([
  "Same day as another exam",
  "Two exams in one day",
  "Same day as paper due",
  "Exam + deadline",
]);

const defaultExamEvents = [
  {
    id: "evt-hindi-quiz-2",
    type: "exam",
    date: "2026-04-08",
    course: "Hindi 105",
    event: "Quiz 2",
    time: "1:25-2:40 PM",
    notes: "",
  },
  {
    id: "evt-polisci-exam-3",
    type: "exam",
    date: "2026-04-20",
    course: "PoliSci 330",
    event: "Exam 3",
    time: "10:05-11:20 AM",
    notes: SAME_DAY_NOTE,
  },
  {
    id: "evt-hindi-final",
    type: "exam",
    date: "2026-04-20",
    course: "Hindi 105",
    event: "Final Exam",
    time: "1:25-2:40 PM",
    notes: SAME_DAY_NOTE,
  },
  {
    id: "evt-hindi-listening",
    type: "exam",
    date: "2026-04-22",
    course: "Hindi 105",
    event: "Listening Exam",
    time: "1:25-2:40 PM",
    notes: "",
  },
  {
    id: "evt-polisci-final",
    type: "exam",
    date: "2026-04-27",
    course: "PoliSci 330",
    event: "Final Exam",
    time: "9:00 AM-12:00 PM",
    notes: "",
  },
  {
    id: "evt-polisci-video",
    type: "deadline",
    date: "2026-04-29",
    course: "PoliSci 330",
    event: "Final Video",
    time: "Due 11:59 PM",
    notes: "",
  },
  {
    id: "evt-econ-204-exam-3",
    type: "exam",
    date: "2026-04-30",
    course: "Econ 204",
    event: "Exam 3",
    time: "9:00-10:40 AM",
    notes: SAME_DAY_NOTE,
  },
  {
    id: "evt-econ-122s-paper",
    type: "deadline",
    date: "2026-04-30",
    course: "Econ 122s",
    event: "Final Paper",
    time: "Due 11:59 PM",
    notes: SAME_DAY_NOTE,
  },
];

const TYPE_COPY = {
  exam: {
    buttonLabel: "Add exam",
    titlePlaceholder: "Midterm 2",
  },
  deadline: {
    buttonLabel: "Add deadline",
    titlePlaceholder: "Final Paper",
  },
};

const pageShell = document.querySelector(".page-shell");
const nextExamCard = document.querySelector("#nextExamCard");
const examGrid = document.querySelector("#examGrid");

const totalEvents = document.querySelector("#totalEvents");
const scheduleSpan = document.querySelector("#scheduleSpan");
const conflictCount = document.querySelector("#conflictCount");
const courseCount = document.querySelector("#courseCount");
const typeFilterSelect = document.querySelector("#typeFilterSelect");
const courseFilterSelect = document.querySelector("#courseFilterSelect");
const clearFiltersButton = document.querySelector("#clearFiltersButton");

const composerModal = document.querySelector("#composerModal");
const coursesModal = document.querySelector("#coursesModal");
const confirmModal = document.querySelector("#confirmModal");

const openComposerButton = document.querySelector("#openComposerButton");
const closeComposerButton = document.querySelector("#closeComposerButton");
const openCoursesButton = document.querySelector("#openCoursesButton");
const closeCoursesButton = document.querySelector("#closeCoursesButton");

const eventForm = document.querySelector("#eventForm");
const eventTypeInputs = [...document.querySelectorAll('input[name="type"]')];
const eventNameInput = document.querySelector("#eventName");
const eventCourseSelect = document.querySelector("#eventCourseSelect");
const eventDateInput = document.querySelector("#eventDate");
const eventStartTimeInput = document.querySelector("#eventStartTime");
const eventEndTimeInput = document.querySelector("#eventEndTime");
const eventDueTimeInput = document.querySelector("#eventDueTime");
const eventNotesInput = document.querySelector("#eventNotes");
const examTimeGroup = document.querySelector("#examTimeGroup");
const deadlineTimeField = document.querySelector("#deadlineTimeField");
const submitButton = document.querySelector("#submitButton");
const formMessage = document.querySelector("#formMessage");

const courseForm = document.querySelector("#courseForm");
const courseNameInput = document.querySelector("#courseNameInput");
const courseMessage = document.querySelector("#courseMessage");
const courseList = document.querySelector("#courseList");

const confirmTitle = document.querySelector("#confirmTitle");
const confirmBody = document.querySelector("#confirmBody");
const confirmCancelButton = document.querySelector("#confirmCancelButton");
const confirmApproveButton = document.querySelector("#confirmApproveButton");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

let examEvents = loadEvents();
let enrolledCourses = loadCourses();
let confirmAction = null;
let lastFocusedButton = null;
let activeFilters = {
  type: "all",
  course: "all",
};

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultCourses() {
  return [...new Set(defaultExamEvents.map(({ course }) => course))].sort();
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function daysUntil(dateString) {
  const diff = parseLocalDate(dateString) - startOfToday();
  return Math.ceil(diff / MS_PER_DAY);
}

function formatCountdown(days) {
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

function truncateText(value, maxLength = 42) {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}...` : value;
}

function getCountdownTone(days, hasConflict) {
  if (days <= 3) {
    return "urgent";
  }

  if (hasConflict) {
    return "warning";
  }

  return "";
}

function normalizeEvent(rawEvent) {
  const normalizedNotes = typeof rawEvent.notes === "string" ? rawEvent.notes.trim() : "";

  return {
    id: typeof rawEvent.id === "string" && rawEvent.id ? rawEvent.id : generateId("evt"),
    type: rawEvent.type === "deadline" ? "deadline" : "exam",
    date: typeof rawEvent.date === "string" ? rawEvent.date.trim() : "",
    course: typeof rawEvent.course === "string" ? rawEvent.course.trim() : "",
    event: typeof rawEvent.event === "string" ? rawEvent.event.trim() : "",
    time: typeof rawEvent.time === "string" ? rawEvent.time.trim() : "",
    notes: LEGACY_SAME_DAY_NOTES.has(normalizedNotes) ? SAME_DAY_NOTE : normalizedNotes,
  };
}

function normalizeCourse(courseName) {
  return typeof courseName === "string" ? courseName.trim() : "";
}

function isValidEvent(event) {
  return Boolean(event.date && event.course && event.event && event.time);
}

function loadEvents() {
  const storedValue = window.localStorage.getItem(EVENTS_STORAGE_KEY);

  if (!storedValue) {
    return defaultExamEvents.map(normalizeEvent);
  }

  try {
    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return defaultExamEvents.map(normalizeEvent);
    }

    const normalizedEvents = parsedValue.map(normalizeEvent).filter(isValidEvent);
    return normalizedEvents.length ? normalizedEvents : defaultExamEvents.map(normalizeEvent);
  } catch (error) {
    return defaultExamEvents.map(normalizeEvent);
  }
}

function loadCourses() {
  const storedValue = window.localStorage.getItem(COURSES_STORAGE_KEY);

  if (!storedValue) {
    return getDefaultCourses();
  }

  try {
    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return getDefaultCourses();
    }

    const normalizedCourses = parsedValue.map(normalizeCourse).filter(Boolean);
    return normalizedCourses.length ? [...new Set(normalizedCourses)].sort() : getDefaultCourses();
  } catch (error) {
    return getDefaultCourses();
  }
}

function saveEvents() {
  window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(examEvents));
}

function saveCourses() {
  window.localStorage.setItem(COURSES_STORAGE_KEY, JSON.stringify(enrolledCourses));
}

function sortEvents(events) {
  return [...events].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
}

function getSelectedType() {
  const selectedInput = eventTypeInputs.find((input) => input.checked);
  return selectedInput ? selectedInput.value : "exam";
}

function setSelectedType(type) {
  eventTypeInputs.forEach((input) => {
    input.checked = input.value === type;
  });
}

function setFormMessage(message, tone = "success") {
  formMessage.textContent = message;
  formMessage.dataset.tone = tone;
}

function setCourseMessage(message, tone = "success") {
  courseMessage.textContent = message;
  courseMessage.dataset.tone = tone;
}

function renderCourseFilterSelect() {
  const selectedCourse = activeFilters.course;

  courseFilterSelect.innerHTML = `
    <option value="all">All courses</option>
    ${enrolledCourses.map((course) => `<option value="${course}">${course}</option>`).join("")}
  `;

  if (selectedCourse !== "all" && enrolledCourses.includes(selectedCourse)) {
    courseFilterSelect.value = selectedCourse;
  } else {
    activeFilters.course = "all";
    courseFilterSelect.value = "all";
  }
}

function renderCourseSelect() {
  const currentValue = eventCourseSelect.value;

  if (!enrolledCourses.length) {
    eventCourseSelect.innerHTML = `<option value="">Add a course first</option>`;
    eventCourseSelect.value = "";
    return;
  }

  eventCourseSelect.innerHTML = `
    <option value="" disabled>Select a course</option>
    ${enrolledCourses.map((course) => `<option value="${course}">${course}</option>`).join("")}
  `;

  if (currentValue && enrolledCourses.includes(currentValue)) {
    eventCourseSelect.value = currentValue;
  } else {
    eventCourseSelect.value = enrolledCourses[0];
  }
}

function renderCourseList() {
  if (!enrolledCourses.length) {
    courseList.innerHTML = `
      <div class="empty-card">
        <p class="empty-card-title">No courses yet.</p>
        <p class="empty-card-text">Add your first course to start creating events.</p>
      </div>
    `;
    return;
  }

  courseList.innerHTML = enrolledCourses
    .map((course) => {
      const eventCount = examEvents.filter((event) => event.course === course).length;
      const countLabel = `${eventCount} item${eventCount === 1 ? "" : "s"}`;

      return `
        <article class="course-row">
          <div>
            <h3 class="course-row-title">${course}</h3>
            <p class="course-row-meta">${countLabel} in the schedule</p>
          </div>
          <button class="delete-button" type="button" data-course-name="${course}">
            Remove
          </button>
        </article>
      `;
    })
    .join("");
}

function syncComposerUI() {
  const type = getSelectedType();
  const isExam = type === "exam";
  const copy = TYPE_COPY[type];

  submitButton.textContent = copy.buttonLabel;
  eventNameInput.placeholder = copy.titlePlaceholder;
  examTimeGroup.classList.toggle("is-hidden", !isExam);
  deadlineTimeField.classList.toggle("is-hidden", isExam);

  eventStartTimeInput.required = isExam;
  eventEndTimeInput.required = isExam;
  eventDueTimeInput.required = !isExam;
}

function hasActiveFilters() {
  return activeFilters.type !== "all" || activeFilters.course !== "all";
}

function updateFilterUI() {
  typeFilterSelect.value = activeFilters.type;
  renderCourseFilterSelect();
  clearFiltersButton.disabled = !hasActiveFilters();
}

function applyFilters(events) {
  return events.filter((event) => {
    const matchesType = activeFilters.type === "all" || event.type === activeFilters.type;
    const matchesCourse = activeFilters.course === "all" || event.course === activeFilters.course;
    return matchesType && matchesCourse;
  });
}

function formatTimeValue(timeValue) {
  if (!timeValue) {
    return "";
  }

  const [hours, minutes] = timeValue.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return timeFormatter.format(date);
}

function buildEventTime() {
  if (getSelectedType() === "deadline") {
    const dueTime = formatTimeValue(eventDueTimeInput.value);
    return dueTime ? `Due ${dueTime}` : "";
  }

  const startTime = formatTimeValue(eventStartTimeInput.value);
  const endTime = formatTimeValue(eventEndTimeInput.value);

  if (!startTime || !endTime) {
    return "";
  }

  return `${startTime}-${endTime}`;
}

function openModal(modal, focusTarget) {
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  pageShell.classList.add("modal-open");
  if (focusTarget) {
    focusTarget.focus();
  }
}

function closeModal(modal) {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");

  if (![composerModal, coursesModal, confirmModal].some((item) => item.classList.contains("is-open"))) {
    pageShell.classList.remove("modal-open");
  }
}

function resetEventForm() {
  eventForm.reset();
  setSelectedType("exam");
  eventDateInput.value = formatDateValue(startOfToday());
  renderCourseSelect();
  syncComposerUI();
  setFormMessage("");
}

function openComposer() {
  if (!enrolledCourses.length) {
    openCoursesButton.focus();
    openCourses();
    return;
  }

  lastFocusedButton = openComposerButton;
  resetEventForm();
  openModal(composerModal, eventNameInput);
}

function closeComposer() {
  closeModal(composerModal);
  if (lastFocusedButton) {
    lastFocusedButton.focus();
  }
}

function openCourses() {
  lastFocusedButton = openCoursesButton;
  setCourseMessage("");
  renderCourseList();
  openModal(coursesModal, courseNameInput);
}

function closeCourses() {
  closeModal(coursesModal);
  if (lastFocusedButton) {
    lastFocusedButton.focus();
  }
}

function openConfirm({ title, body, action, confirmLabel = "Delete" }) {
  confirmAction = action;
  confirmTitle.textContent = title;
  confirmBody.textContent = body;
  confirmApproveButton.textContent = confirmLabel;
  openModal(confirmModal, confirmCancelButton);
}

function closeConfirm() {
  confirmAction = null;
  closeModal(confirmModal);
}

function groupEventsByDate(events) {
  return events.reduce((map, event) => {
    if (!map.has(event.date)) {
      map.set(event.date, []);
    }

    map.get(event.date).push(event);
    return map;
  }, new Map());
}

function renderNextExam(events) {
  const upcoming = events.find(({ date }) => daysUntil(date) >= 0);

  if (!upcoming) {
    nextExamCard.innerHTML = `
      <div class="next-exam-content">
        <h2 class="next-title">Nothing upcoming</h2>
        <p class="next-details">No exams or deadlines in this view.</p>
      </div>
    `;
    return;
  }

  const daysRemaining = daysUntil(upcoming.date);
  const countdown = formatCountdown(daysRemaining);
  const statusText = truncateText(upcoming.notes);
  const detailsLine = `${dateFormatter.format(parseLocalDate(upcoming.date))} • ${upcoming.course} • ${upcoming.time}`;
  const summaryLine = statusText
    ? `<p class="next-summary"><span class="next-summary-strong">${countdown}</span> • ${statusText}</p>`
    : `<p class="next-summary"><span class="next-summary-strong">${countdown}</span></p>`;

  nextExamCard.innerHTML = `
    <div class="next-exam-content">
      <h2 class="next-title">${upcoming.event}</h2>
      <p class="next-details">${detailsLine}</p>
      ${summaryLine}
    </div>
  `;
}

function renderStats(events, groupedEntries) {
  const allDates = events.map(({ date }) => daysUntil(date));
  const remainingDates = allDates.filter((days) => days >= 0);
  const uniqueCourses = new Set(events.map(({ course }) => course));
  const conflictDays = groupedEntries.filter(([, items]) => items.length > 1);

  totalEvents.textContent = String(events.length).padStart(2, "0");
  scheduleSpan.textContent = remainingDates.length
    ? String(Math.max(...remainingDates)).padStart(2, "0")
    : "00";
  conflictCount.textContent = String(conflictDays.length).padStart(2, "0");
  courseCount.textContent = String(uniqueCourses.size).padStart(2, "0");
}

function renderTimeline(groupedEntries) {
  if (!groupedEntries.length) {
    examGrid.innerHTML = `
      <article class="exam-card">
        <div class="empty-board">
          <p class="section-kicker">${hasActiveFilters() ? "No Matches" : "No Events Yet"}</p>
          <h3 class="empty-board-title">${
            hasActiveFilters() ? "No items match these filters." : "Add your first exam or deadline."
          }</h3>
          <p class="empty-board-text">${
            hasActiveFilters()
              ? "Try a different type or course, or clear the filters."
              : "Use the Add item button to build your schedule."
          }</p>
        </div>
      </article>
    `;
    return;
  }

  examGrid.innerHTML = groupedEntries
    .map(([date, events], index) => {
      const countdownDays = daysUntil(date);
      const countdownText = formatCountdown(countdownDays);
      const hasConflict = events.length > 1;
      const tone = getCountdownTone(countdownDays, hasConflict);
      const dayLabel = dateFormatter.format(parseLocalDate(date));

      return `
        <article class="exam-card ${tone} ${hasConflict ? "has-conflict" : ""}" style="animation-delay: ${
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
                      <h3 class="course-name">${event.course}</h3>
                      <div class="event-actions">
                        <span class="badge ${event.type}">${event.type === "deadline" ? "Deadline" : "Exam"}</span>
                        <button class="delete-button" type="button" data-event-id="${event.id}">
                          Delete
                        </button>
                      </div>
                    </div>
                    <div class="event-meta">
                      <span class="event-name">${event.event}</span>
                      <span class="event-time">${event.time}</span>
                    </div>
                    ${
                      event.notes
                        ? `<div class="event-note"><span class="note-pill">${event.notes}</span></div>`
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

function renderApp() {
  const sortedEvents = sortEvents(examEvents);
  const filteredEvents = applyFilters(sortedEvents);
  const groupedEntries = [...groupEventsByDate(filteredEvents).entries()];

  renderNextExam(filteredEvents);
  renderStats(filteredEvents, groupedEntries);
  renderTimeline(groupedEntries);
  renderCourseSelect();
  renderCourseList();
  updateFilterUI();
}

function handleAddEvent(event) {
  event.preventDefault();

  const newEvent = normalizeEvent({
    type: getSelectedType(),
    date: eventDateInput.value,
    course: eventCourseSelect.value,
    event: eventNameInput.value,
    time: buildEventTime(),
    notes: eventNotesInput.value,
  });

  if (!isValidEvent(newEvent)) {
    setFormMessage("Fill in the title, course, date, and time fields.", "warning");
    return;
  }

  examEvents = sortEvents([...examEvents, newEvent]);
  saveEvents();
  renderApp();
  closeComposer();
}

function handleAddCourse(event) {
  event.preventDefault();

  const nextCourse = normalizeCourse(courseNameInput.value);

  if (!nextCourse) {
    setCourseMessage("Enter a course name first.", "warning");
    return;
  }

  if (enrolledCourses.some((course) => course.toLowerCase() === nextCourse.toLowerCase())) {
    setCourseMessage("That course is already in your list.", "warning");
    return;
  }

  enrolledCourses = [...enrolledCourses, nextCourse].sort();
  saveCourses();
  renderApp();
  courseForm.reset();
  setCourseMessage(`${nextCourse} added.`);
  courseNameInput.focus();
}

function deleteEvent(eventId) {
  examEvents = examEvents.filter((event) => event.id !== eventId);
  saveEvents();
  renderApp();
}

function deleteCourse(courseName) {
  enrolledCourses = enrolledCourses.filter((course) => course !== courseName);
  examEvents = examEvents.filter((event) => event.course !== courseName);
  saveCourses();
  saveEvents();

  if (activeFilters.course === courseName) {
    activeFilters.course = "all";
  }

  renderApp();
  setCourseMessage(`${courseName} removed.`);
}

function handleFilterChange() {
  activeFilters.type = typeFilterSelect.value;
  activeFilters.course = courseFilterSelect.value;
  renderApp();
}

function clearFilters() {
  activeFilters = {
    type: "all",
    course: "all",
  };
  renderApp();
}

function handleTimelineClick(event) {
  const deleteButton = event.target.closest("[data-event-id]");

  if (!deleteButton) {
    return;
  }

  const eventId = deleteButton.dataset.eventId;
  const eventToDelete = examEvents.find((item) => item.id === eventId);

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
  const deleteButton = event.target.closest("[data-course-name]");

  if (!deleteButton) {
    return;
  }

  const courseName = deleteButton.dataset.courseName;
  const relatedEvents = examEvents.filter((item) => item.course === courseName).length;
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
    confirmAction();
  }

  closeConfirm();
}

function handleKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (confirmModal.classList.contains("is-open")) {
    closeConfirm();
    return;
  }

  if (coursesModal.classList.contains("is-open")) {
    closeCourses();
    return;
  }

  if (composerModal.classList.contains("is-open")) {
    closeComposer();
  }
}

function initComposer() {
  eventDateInput.value = formatDateValue(startOfToday());
  eventTypeInputs.forEach((input) => input.addEventListener("change", syncComposerUI));
  eventForm.addEventListener("submit", handleAddEvent);
  openComposerButton.addEventListener("click", openComposer);
  closeComposerButton.addEventListener("click", closeComposer);
  syncComposerUI();
}

function initCourses() {
  openCoursesButton.addEventListener("click", openCourses);
  closeCoursesButton.addEventListener("click", closeCourses);
  courseForm.addEventListener("submit", handleAddCourse);
  courseList.addEventListener("click", handleCourseListClick);
}

function initFilters() {
  typeFilterSelect.addEventListener("change", handleFilterChange);
  courseFilterSelect.addEventListener("change", handleFilterChange);
  clearFiltersButton.addEventListener("click", clearFilters);
}

function initConfirm() {
  confirmCancelButton.addEventListener("click", closeConfirm);
  confirmApproveButton.addEventListener("click", handleConfirmApprove);
}

function initSharedModalClose() {
  document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", () => {
      const modalName = element.dataset.closeModal;

      if (modalName === "composer") {
        closeComposer();
      }

      if (modalName === "courses") {
        closeCourses();
      }
    });
  });
}

function init() {
  renderApp();
  initComposer();
  initCourses();
  initFilters();
  initConfirm();
  initSharedModalClose();
  examGrid.addEventListener("click", handleTimelineClick);
  document.addEventListener("keydown", handleKeydown);
}

init();
