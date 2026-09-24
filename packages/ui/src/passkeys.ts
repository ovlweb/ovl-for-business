import type { OvlClient } from '@ovl/sdk';
import type { Me } from '@ovl/shared';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

/** Whether this browser can use passkeys at all. */
export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

/** True when the person closed the browser's passkey dialog (not worth an error message). */
export function passkeyCancelled(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

/** Create a passkey on this device (or password manager) and add it to the signed-in account. */
export async function addPasskey(api: OvlClient, name: string) {
  const { challengeId, options } = await api.me.passkeys.options();
  const response = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  return api.me.passkeys.add(challengeId, name, response);
}

/** Ask the browser for a passkey answer; send it to POST /auth/passkey to sign in. */
export async function passkeyAssertion(api: OvlClient): Promise<{ challengeId: string; response: unknown }> {
  const { challengeId, options } = await api.auth.passkeyOptions();
  const response = await startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  return { challengeId, response };
}

/** Sign in with any passkey saved for this site. */
export async function signInWithPasskey(api: OvlClient): Promise<Me> {
  const { challengeId, response } = await passkeyAssertion(api);
  return api.auth.passkeyLogin(challengeId, response);
}
