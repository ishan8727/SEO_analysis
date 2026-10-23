import { getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Browser-only Firebase Auth for the phone gate. Imported dynamically by Gate.tsx so the SDK
// never lands in the landing-page bundle. The web config is public by design; the API key is
// restricted to our domains in Google Cloud.

export { RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

export function firebaseAuth(): Auth {
  const app = getApps()[0] ?? initializeApp(config);
  const auth = getAuth(app);
  auth.useDeviceLanguage(); // SMS text and reCAPTCHA in the visitor's language
  return auth;
}
