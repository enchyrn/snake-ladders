import { useAtomValue } from "@effect-atom/atom-react"
import { desyncAtom, noticeAtom } from "@/store/atoms"

/**
 * Each banner subscribes to exactly the one field it renders. Kept apart from
 * the board and the HUD so a notice popping up (routine — an illegal card
 * play, a mistimed roll) never re-renders the 3D scene, and a desync (rare,
 * and never something to paper over) is never missed for the same reason.
 */
export const NoticeBanner = () => {
  const notice = useAtomValue(noticeAtom)
  if (!notice) return null
  return (
    <p className="banner notice" role="status">
      {notice}
    </p>
  )
}

export const DesyncBanner = () => {
  const desync = useAtomValue(desyncAtom)
  if (!desync) return null
  return (
    <p className="banner desync" role="alert">
      Out of sync with the host: {desync}
    </p>
  )
}
