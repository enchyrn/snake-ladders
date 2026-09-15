/**
 * Wrap an async action so a call made while one is still running is dropped
 * rather than started, and report the busy state so a caller can disable
 * whatever triggers it.
 *
 * The flag is a closure variable, not React state: the wrapped action is
 * `async` and reads the flag again after an `await`, where a state value would
 * be the one captured when the closure was created. `report` exists precisely
 * so rendering can still follow along — the same split as `client-slot.ts`,
 * for the same reason.
 */
export const onceAtATime = <A extends unknown[]>(
  run: (...args: A) => Promise<void>,
  report: (busy: boolean) => void,
): ((...args: A) => Promise<void>) => {
  let busy = false
  return async (...args: A) => {
    if (busy) return
    busy = true
    report(true)
    try {
      await run(...args)
    } finally {
      // `finally`, so a throw clears it too: the one outcome that most needs a
      // retry must not be the one that wedges the screen.
      busy = false
      report(false)
    }
  }
}
