import {
  DEFAULT_SEMESTER_END_DATE,
  DEFAULT_SEMESTER_LABEL,
  DEFAULT_SEMESTER_START_DATE,
  TYPE_COPY,
} from "./config.js";
import { renderApp } from "./render.js";
import {
  COURSE_DAY_OPTIONS,
  buildEventTime,
  courseHasClassSchedule,
  courseNameEquals,
  formatDateValue,
  getCourseByName,
  getCourseName,
  isDateOnCourseDay,
  isValidEvent,
  normalizeClockTime,
  normalizeCourse,
  normalizeEvent,
  sortCourses,
  sortEvents,
  startOfToday,
} from "./utils.js";

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
    filters: {
      type: "all",
      course: "all",
    },
    setup: createDefaultSetupState(),
  };

  let confirmAction = null;
  let lastFocusedElement = null;
  let activeAuthSequence = 0;
  let editingEventId = null;
  let editingCourseOriginalName = null;
  let isDeletingAccount = false;

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

  function syncComposerPresetLabel() {
    const type = getSelectedType();
    dom.eventTimingPresetLabel.textContent = type === "exam" ? "During class" : "Before class";
  }

  function syncEditPresetLabel() {
    const type = getSelectedEditType();
    dom.editTimingPresetLabel.textContent = type === "exam" ? "During class" : "Before class";
  }

  function applyComposerCourseTimingPreset({ clearMessage = false } = {}) {
    syncComposerPresetLabel();
    const selectedCourse = getCourseBySelection(dom.eventCourseSelect.value);
    const hasSchedule = courseHasClassSchedule(selectedCourse);
    const shouldLockTimes = dom.eventUseCourseTimingInput.checked && hasSchedule;

    dom.eventUseCourseTimingInput.disabled = !hasSchedule;

    if (!hasSchedule) {
      dom.eventUseCourseTimingInput.checked = false;
    }

    if (shouldLockTimes && selectedCourse) {
      if (getSelectedType() === "exam") {
        dom.eventStartTimeInput.value = selectedCourse.startTime;
        dom.eventEndTimeInput.value = selectedCourse.endTime;
      } else {
        dom.eventDueTimeInput.value = selectedCourse.startTime;
      }
    }

    dom.eventStartTimeInput.disabled = shouldLockTimes;
    dom.eventEndTimeInput.disabled = shouldLockTimes;
    dom.eventDueTimeInput.disabled = shouldLockTimes;

    if (clearMessage) {
      setFormMessage("");
    }
  }

  function applyEditCourseTimingPreset({ clearMessage = false } = {}) {
    syncEditPresetLabel();
    const selectedCourse = getCourseBySelection(dom.editEventCourseSelect.value);
    const hasSchedule = courseHasClassSchedule(selectedCourse);
    const shouldLockTimes = dom.editEventUseCourseTimingInput.checked && hasSchedule;

    dom.editEventUseCourseTimingInput.disabled = !hasSchedule;

    if (!hasSchedule) {
      dom.editEventUseCourseTimingInput.checked = false;
    }

    if (shouldLockTimes && selectedCourse) {
      if (getSelectedEditType() === "exam") {
        dom.editEventStartTimeInput.value = selectedCourse.startTime;
        dom.editEventEndTimeInput.value = selectedCourse.endTime;
      } else {
        dom.editEventDueTimeInput.value = selectedCourse.startTime;
      }
    }

    dom.editEventStartTimeInput.disabled = shouldLockTimes;
    dom.editEventEndTimeInput.disabled = shouldLockTimes;
    dom.editEventDueTimeInput.disabled = shouldLockTimes;

    if (clearMessage) {
      setEditFormMessage("");
    }
  }

  function validateComposerPresetDate({ clearInvalidDate = false } = {}) {
    if (!dom.eventUseCourseTimingInput.checked) {
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
    if (!dom.editEventUseCourseTimingInput.checked) {
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
    state.filters = {
      type: "all",
      course: "all",
    };
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
    dom.editEventNotesInput.value = eventRecord.notes ?? "";
    dom.editEventStartTimeInput.value = eventRecord.startTime ?? "";
    dom.editEventEndTimeInput.value = eventRecord.endTime ?? "";
    dom.editEventDueTimeInput.value = eventRecord.startTime ?? eventRecord.endTime ?? "";
    syncEditUI();
    setEditFormMessage("");
    openModal(dom.editModal, dom.editEventNameInput);
  }

  function closeEdit() {
    resetEditForm();
    closeModal(dom.editModal);
    restoreFocus();
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

  async function persistEvents() {
    const userId = requireUserId();

    if (!userId) {
      return;
    }

    await scheduleRepository.saveEvents(userId, state.events);
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
      },
      { markSetupComplete },
    );

    state.preferences = {
      semester: savedState?.semesterLabel || DEFAULT_SEMESTER_LABEL,
      startDate: savedState?.semesterStart || "",
      endDate: savedState?.semesterEnd || "",
    };

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
    });

    if (!isValidEvent(newEvent)) {
      setFormMessage("Fill in the title, course, date, and time fields.", "warning");
      return;
    }

    state.events = sortEvents([...state.events, newEvent]);
    await persistEvents();
    render();
    closeComposer();
  }

  async function handleEditEvent(event) {
    event.preventDefault();
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
    });

    if (!isValidEvent(updatedEvent)) {
      setEditFormMessage("Fill in the title, course, date, and time fields.", "warning");
      return;
    }

    state.events = sortEvents(state.events.map((item) => (item.id === editingEventId ? updatedEvent : item)));
    await persistEvents();
    render();
    closeEdit();
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

        if (courseNameEquals(state.filters.course, editingCourseOriginalName)) {
          state.filters.course = nextCourse.name;
        }
      }

      await persistCourses();
      render();
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
      resetCourseFormEditor();
      setCourseMessage(`${nextCourse.name} updated.`);
      dom.courseNameInput.focus();
      return;
    }

    state.courses = sortCourses([...state.courses, nextCourse]);
    await persistCourses();
    render();
    resetCourseFormEditor();
    setCourseMessage(`${nextCourse.name} added.`);
    dom.courseNameInput.focus();
  }

  async function handleSaveAccountSettings(event) {
    event.preventDefault();

    const semester = typeof dom.semesterInput.value === "string" ? dom.semesterInput.value.trim() : "";
    const startDate = normalizeDateValue(dom.semesterStartDateInput.value);
    const endDate = normalizeDateValue(dom.semesterEndDateInput.value);

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
      markSetupComplete: false,
    });
    render();
    setAccountSettingsMessage("Settings saved.");
  }

  async function deleteEvent(eventId) {
    state.events = state.events.filter((event) => event.id !== eventId);
    await persistEvents();
    render();
  }

  async function deleteCourse(courseName) {
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
    setCourseMessage(`${courseName} removed.`);
  }

  async function clearUserScheduleData() {
    state.events = [];
    state.courses = [];
    state.filters = {
      type: "all",
      course: "all",
    };
    resetCourseFormEditor();
    resetEditForm();
    await persistCourses();
    await persistEvents();
    render();
    setAccountSettingsMessage("All schedule data cleared.");
  }

  function handleFilterChange() {
    state.filters.type = dom.typeFilterSelect.value;
    state.filters.course = dom.courseFilterSelect.value;
    render();
  }

  function clearFilters() {
    state.filters = {
      type: "all",
      course: "all",
    };
    render();
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
    dom.eventUseCourseTimingInput.addEventListener("change", () => {
      applyComposerCourseTimingPreset({ clearMessage: true });
      validateComposerPresetDate({ clearInvalidDate: true });
    });
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
    dom.editEventUseCourseTimingInput.addEventListener("change", () => {
      applyEditCourseTimingPreset({ clearMessage: true });
      validateEditPresetDate({ clearInvalidDate: true });
    });
    dom.editEventForm.addEventListener("submit", handleEditEvent);
    dom.closeEditButton.addEventListener("click", closeEdit);
    syncEditUI();
  }

  function initFilters() {
    dom.typeFilterSelect.addEventListener("change", handleFilterChange);
    dom.courseFilterSelect.addEventListener("change", handleFilterChange);
    dom.clearFiltersButton.addEventListener("click", clearFilters);
  }

  function initAccountSettings() {
    dom.accountButton.addEventListener("click", handleAccountButtonClick);
    dom.closeAccountButton.addEventListener("click", closeAccountSettings);
    dom.accountSettingsForm.addEventListener("submit", handleSaveAccountSettings);
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

  return {
    init() {
      render();
      initComposer();
      initCourses();
      initEdit();
      initFilters();
      initAccountSettings();
      initDeleteAccount();
      initConfirm();
      initSharedModalClose();
      initSetupFlow();
      initAuthSubscription();
      dom.examGrid.addEventListener("click", handleTimelineClick);
      document.addEventListener("click", handleSessionActionClick, { capture: true });
      document.addEventListener("keydown", handleKeydown);
    },
  };
}
