import { Platform } from 'react-native';

export const accountConfig = {
  distribution: process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION ?? 'store',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  microsoftClientId: process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID ?? '',
  microsoftTenant: process.env.EXPO_PUBLIC_MICROSOFT_TENANT ?? 'common',
  microsoftRedirectUri:
    process.env.EXPO_PUBLIC_MICROSOFT_REDIRECT_URI ?? 'context://oauth/microsoft',
};

export function assertGoogleConfiguration() {
  if (accountConfig.distribution === 'fdroid') {
    throw new Error(
      'This F-Droid edition uses open-source native components and does not include Google Sign-In. Use calendars already connected to your phone, or synchronize the private ledger through Microsoft or WebDAV storage. Direct Google account connection is available in the Google Play and App Store editions.',
    );
  }
  if (!accountConfig.googleWebClientId || (Platform.OS === 'ios' && !accountConfig.googleIosClientId)) {
    throw new Error(
      'Google connection needs the Context OAuth client IDs in the app build. Configure EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, then rebuild the app.',
    );
  }
}

export function assertMicrosoftConfiguration() {
  if (!accountConfig.microsoftClientId) {
    throw new Error(
      'Microsoft connection needs a Context app registration. Configure EXPO_PUBLIC_MICROSOFT_CLIENT_ID and register context://oauth/microsoft as a mobile redirect URI, then rebuild the app.',
    );
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(accountConfig.microsoftTenant)) {
    throw new Error('The Microsoft tenant setting is invalid.');
  }
}
