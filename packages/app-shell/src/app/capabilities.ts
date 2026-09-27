/**
 * Every environment-dependent setting asks what this device can do, never what
 * platform it is. Haptics has one backend today (navigator.vibrate, absent in
 * all of WebKit) and could gain a second (a Tauri plugin, which would reach
 * only the installed iOS app ADR 0011 keeps manual) without this layer moving.
 *
 * Wake lock is [SecureContext], and the host-served join serves plain HTTP, so
 * it is absent on precisely the guest phones that scanned in. The probe is what
 * keeps the control from claiming otherwise.
 */
export const hasHaptics = (nav: Partial<Navigator>): boolean => typeof nav.vibrate === "function"

export const hasWakeLock = (nav: Partial<Navigator>, isSecureContext: boolean): boolean =>
  isSecureContext && nav.wakeLock !== undefined

export const vibrate = (nav: Partial<Navigator>, pattern: number | ReadonlyArray<number>): void => {
  if (!hasHaptics(nav)) return
  try {
    nav.vibrate?.(pattern as number | number[])
  } catch {
    // A denied or throwing backend is a cosmetic loss, never a failed round.
  }
}
