import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { config, DRIVE_SCOPES } from '@/lib/config';

let configured = false;

export function configureGoogleSignin() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: config.google.webClientId,
    iosClientId: config.google.iosClientId,
    offlineAccess: true,
    forceCodeForRefreshToken: true,
    scopes: [...DRIVE_SCOPES],
  });
  configured = true;
}

export async function promptGoogleSignIn() {
  configureGoogleSignin();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  return await GoogleSignin.signIn();
}
