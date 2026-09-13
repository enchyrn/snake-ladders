import { RegistryProvider } from "@effect-atom/atom-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { StrictMode, lazy } from "react"
import { createRoot } from "react-dom/client"
import { SessionProvider } from "@mutation/app-shell/app/session"
import { HomeScreen } from "@mutation/app-shell/routes/home"
import { JoinScreen } from "@mutation/app-shell/routes/join"
import { LobbyScreen } from "@mutation/app-shell/routes/lobby"
import { MatchScreen } from "@mutation/app-shell/routes/match"
import { PwaPrompt } from "@mutation/ui/PwaPrompt"
import "./styles.css"

// The ternary, not an `if`, matters: the bundler folds `import.meta.env.DEV`
// to a literal at build time and then eliminates the untaken branch —
// including the dynamic import inside it — so devtools never end up in a
// production chunk at all, rather than merely being hidden behind a flag.
const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )
  : () => null

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : () => null

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <PwaPrompt />
      <RouterDevtools />
      <QueryDevtools />
    </>
  ),
})

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomeScreen })
const joinRoute = createRoute({ getParentRoute: () => rootRoute, path: "/join", component: JoinScreen })
const lobbyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/lobby", component: LobbyScreen })
const matchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/match", component: MatchScreen })

const routeTree = rootRoute.addChildren([homeRoute, joinRoute, lobbyRoute, matchRoute])
// Hash history, not path history: this bundle is served from wherever it
// happens to land — a Tauri custom scheme, a static host under a subdirectory,
// a file:// path — and a path router matches none of its routes when the page
// sits below the origin root, rendering a not-found page instead of the game.
// The fragment is the one part of the URL no host rewrites.
const router = createRouter({ routeTree, history: createHashHistory() })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const queryClient = new QueryClient()

// index.html declares this element unconditionally, so its absence would
// mean the page shell itself failed to load — nothing this script does could
// recover from that anyway.
const container = document.getElementById("root")!

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RegistryProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </RegistryProvider>
    </QueryClientProvider>
  </StrictMode>,
)
