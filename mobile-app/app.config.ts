import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * DocTurn native shell — Expo config (replaces app.json so the host can come
 * from the build environment).
 *
 *   EXPO_PUBLIC_API_BASE_URL  the DocTurn host the shell loads and links to
 *                             (eas.json sets it per build profile)
 *   EAS_PROJECT_ID            from `eas init` — required for push tokens
 *
 * Universal / app links are declared for that host; the server answers the
 * matching association files from APPLE_TEAM_ID / IOS_BUNDLE_ID /
 * ANDROID_PACKAGE / ANDROID_SHA256_CERT_FINGERPRINTS (server/routes/well-known.ts).
 */
const BRAND = "#2563EB";
const BUNDLE_ID = "com.docturn.app";
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || "https://docturn.onrender.com").replace(/\/+$/, "");
const hostMatch = /^(https?):\/\/([^/?#]+)/i.exec(apiBaseUrl);
const https = hostMatch?.[1]?.toLowerCase() === "https";
const host = hostMatch?.[2] ?? "";
const easProjectId = process.env.EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "DocTurn",
  slug: "docturn",
  version: "1.0.0",
  scheme: "docturn",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#FFFFFF",
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    associatedDomains: https ? [`applinks:${host}`, `webcredentials:${host}`] : [],
    config: { usesNonExemptEncryption: false }, // HTTPS only — standard, exempt encryption
    infoPlist: {
      NSCameraUsageDescription: "DocTurn uses the camera to capture an image for a secure clinical message.",
      NSMicrophoneUsageDescription: "DocTurn uses the microphone to record a voice message.",
      // Lets the page's service worker run inside the WebView (iOS allows it
      // only for app-bound domains); the shell never navigates elsewhere.
      // HTTPS hosts only, without a port (a development build on http://
      // must not be limited to app-bound domains — src/shell/config.ts).
      ...(https && host ? { WKAppBoundDomains: [host.replace(/:\d+$/, "")] } : {}),
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      // Required-reason APIs used by React Native / Expo (standard declarations).
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
      ],
      // What the DocTurn service receives through the app (all for the app to
      // work, linked to the clinician's account, never for tracking). Must
      // match the App Privacy answers in App Store Connect — docs/MOBILE.md.
      NSPrivacyCollectedDataTypes: [
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeName", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeHealth", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeOtherUserContent", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
        { NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID", NSPrivacyCollectedDataTypeLinked: true, NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      ],
    },
  },
  android: {
    package: BUNDLE_ID,
    // FCM credentials for Expo push on Android: an EAS file-type environment
    // variable (GOOGLE_SERVICES_JSON) pointing at the google-services.json
    // downloaded from the Firebase project — never committed (README.md).
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
      backgroundColor: BRAND,
    },
    // Camera / microphone for the page's image capture and voice messages;
    // POST_NOTIFICATIONS and VIBRATE come with expo-notifications.
    permissions: ["android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"],
    allowBackup: false, // no cloud backup of the WebView's cookie / storage
    softwareKeyboardLayoutMode: "resize",
    predictiveBackGestureEnabled: false,
    intentFilters: https
      ? [{
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host, pathPrefix: "/messages/" },
            { scheme: "https", host, path: "/" },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        }]
      : [],
  },
  plugins: [
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 160, resizeMode: "contain", backgroundColor: BRAND, dark: { backgroundColor: BRAND } }],
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: BRAND, defaultChannel: "routine", enableBackgroundRemoteNotifications: false }],
    "expo-dev-client",
  ],
  extra: {
    apiBaseUrl,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
