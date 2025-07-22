import {createBrowserRouter, createRoutesFromElements, Route} from "react-router"
import {lazy, Suspense} from "react"

import {LoadingFallback} from "@/shared/components/LoadingFallback"
import NostrLinkHandler from "@/pages/NostrLinkHandler.tsx"
import Notifications from "./notifications/Notifications"
import Layout from "@/shared/components/Layout"
import WalletPage from "./wallet/WalletPage"
import {AboutPage} from "@/pages/HelpPage"
import SearchPage from "@/pages/search"
import HomePage from "@/pages/home"

// Lazy load components
const ChatsPage = lazy(() => import("@/pages/chats"))
const SettingsPage = lazy(() => import("@/pages/settings"))
const SubscriptionPage = lazy(() => import("@/pages/subscription"))
const RelayPage = lazy(() => import("@/pages/relay"))

export const router = createBrowserRouter(
  createRoutesFromElements([
    <Route key={1} element={<Layout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/wallet" element={<WalletPage />} />
      <Route
        path="/chats/*"
        element={
          <Suspense fallback={<LoadingFallback />}>
            <ChatsPage />
          </Suspense>
        }
      />
      <Route
        path="/settings/*"
        element={
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPage />
          </Suspense>
        }
      />
      <Route
        path="/subscribe"
        element={
          <Suspense fallback={<LoadingFallback />}>
            <SubscriptionPage />
          </Suspense>
        }
      />
      <Route path="/search/:query?" element={<SearchPage />} />
      <Route
        path="/relay/:url?"
        element={
          <Suspense fallback={<LoadingFallback />}>
            <RelayPage />
          </Suspense>
        }
      />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/:link/*" element={<NostrLinkHandler />} />
    </Route>,
  ])
)
