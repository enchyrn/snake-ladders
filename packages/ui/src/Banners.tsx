/**
 * The two banner views, as pure functions of what they render.
 *
 * They take their text rather than subscribing, because `ui` sits below
 * `app-shell` and the store lives up there — reaching up for the atoms is the
 * cycle the layer tags exist to prevent. `app-shell` owns the subscription and
 * keeps it in a leaf of its own, which is what preserves the property below.
 *
 * Kept apart from the board and the HUD so a notice popping up (routine — an
 * illegal card play, a mistimed roll) never re-renders the 3D scene, and a
 * desync (rare, and never something to paper over) is never missed for the
 * same reason.
 */
export const NoticeBannerView = ({ notice }: { notice: string | null }) => {
  if (!notice) return null
  return (
    <p className="banner notice" role="status">
      {notice}
    </p>
  )
}

export const DesyncBannerView = ({ desync }: { desync: string | null }) => {
  if (!desync) return null
  return (
    <p className="banner desync" role="alert">
      Out of sync with the host: {desync}
    </p>
  )
}
