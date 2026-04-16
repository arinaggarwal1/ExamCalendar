import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  GoogleAuthProvider,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { FIREBASE_CONFIG } from "../config.js";

function mapFirebaseUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.uid,
    displayName: user.displayName || user.email || "User",
    email: user.email || "",
  };
}

function getOrCreateFirebaseApp(firebaseConfig) {
  if (!firebaseConfig?.apiKey) {
    return null;
  }

  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function createFirebaseSessionService({ firebaseConfig = FIREBASE_CONFIG } = {}) {
  const firebaseApp = getOrCreateFirebaseApp(firebaseConfig);
  const auth = firebaseApp ? getAuth(firebaseApp) : null;
  const provider = new GoogleAuthProvider();

  provider.setCustomParameters({ prompt: "select_account" });

  function requireCurrentUser() {
    if (!auth?.currentUser) {
      throw new Error("No signed-in Firebase user is available.");
    }

    return auth.currentUser;
  }

  return {
    subscribe(callback) {
      if (!auth) {
        callback(null);
        return () => {};
      }

      return onAuthStateChanged(auth, (user) => {
        callback(mapFirebaseUser(user));
      });
    },

    async signIn() {
      if (!auth) {
        throw new Error("Firebase Auth is not configured. Add FIREBASE_CONFIG before signing in.");
      }

      await signInWithPopup(auth, provider);
    },

    async signOut() {
      if (!auth) {
        return;
      }

      await firebaseSignOut(auth);
    },

    async reauthenticateUser() {
      const currentUser = requireCurrentUser();
      await reauthenticateWithPopup(currentUser, provider);
    },

    async deleteAuthUser() {
      const currentUser = requireCurrentUser();
      await deleteUser(currentUser);
    },
  };
}
