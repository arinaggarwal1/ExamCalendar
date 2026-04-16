import { LOCAL_PREVIEW_USER_ID } from "../config.js";

export function createLocalSessionService() {
  return {
    async getSession() {
      return {
        status: "signed-in",
        user: {
          id: LOCAL_PREVIEW_USER_ID,
          displayName: "Local Preview",
          isLocalPreview: true,
        },
      };
    },
  };
}
