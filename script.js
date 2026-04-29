import { createAppController } from "./js/appController.js?v=3";
import { getDom } from "./js/dom.js";
import { createFirestoreScheduleRepository } from "./js/repositories/firestoreScheduleRepository.js";
import { createFirebaseSessionService } from "./js/services/firebaseSessionService.js";

const dom = getDom();

const appController = createAppController({
  dom,
  sessionService: createFirebaseSessionService(),
  scheduleRepository: createFirestoreScheduleRepository(),
});

appController.init();
