import { useAtomValue } from "@effect-atom/atom-react"
import { DesyncBannerView, NoticeBannerView } from "@mutation/ui/Banners"
import { desyncAtom, noticeAtom } from "../store/atoms"

/**
 * The store-connected halves of the banner views in `ui`.
 *
 * Each one subscribes to exactly the one field it renders and is a leaf, so a
 * notice or a desync re-renders only its own banner — never the 3D scene. That
 * is why the subscription lives in a component of its own rather than in the
 * route that places it.
 */
export const NoticeBanner = () => <NoticeBannerView notice={useAtomValue(noticeAtom)} />

export const DesyncBanner = () => <DesyncBannerView desync={useAtomValue(desyncAtom)} />
