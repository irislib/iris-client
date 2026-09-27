import {lazy} from "react"
import {RouteDefinition} from "./types"

// Import pages
import NostrLinkHandler from "@/pages/NostrLinkHandler"
import Notifications from "@/pages/notifications/Notifications"
import {AboutPage} from "@/pages/AboutPage"
import TermsPage from "@/pages/TermsPage"
import PrivacyPage from "@/pages/PrivacyPage"
import CsaePage from "@/pages/CsaePage"
import SearchPage from "@/pages/search"
import HomePage from "@/pages/home"
import NewNote from "@/pages/new"

// Lazy load components
const ChatsPage = lazy(() => import("@/pages/chats"))
const SettingsPage = lazy(() => import("@/pages/settings"))
const RelayPage = lazy(() => import("@/pages/relay"))
const MapPage = lazy(() => import("@/pages/map"))
const MarketPage = lazy(() => import("@/pages/market"))
const UserSearchPage = lazy(() => import("@/pages/user-search"))
const CashuWallet = lazy(() => import("@/pages/wallet/CashuWallet"))
const OldWallet = lazy(() => import("@/pages/wallet/OldWallet"))
const GroupsPage = lazy(() => import("@/pages/groups"))
const GroupPage = lazy(() => import("@/pages/groups/GroupPage"))

export const routes: RouteDefinition[] = [
  {
    path: "/",
    component: CONFIG.appVariant === "groups" ? GroupsPage : HomePage,
    alwaysKeep: true,
  },
  {path: "/groups", component: GroupsPage},
  {path: "/groups/:owner/:groupId", component: GroupPage},
  {path: "/new", component: NewNote},
  {path: "/notifications", component: Notifications},
  {path: "/wallet", component: CashuWallet},
  {path: "/old-wallet", component: OldWallet},
  {path: "/chats/*", component: ChatsPage},
  {path: "/settings/*", component: SettingsPage},
  {path: "/search", component: SearchPage},
  {path: "/search/:query", component: SearchPage},
  {path: "/m", component: MarketPage},
  {path: "/m/:category", component: MarketPage},
  {path: "/u", component: UserSearchPage},
  {path: "/u/:query", component: UserSearchPage},
  {path: "/relay", component: RelayPage},
  {path: "/relay/:url", component: RelayPage},
  {path: "/map", component: MapPage},
  {path: "/map/:query", component: MapPage},
  {path: "/about", component: AboutPage},
  {path: "/terms", component: TermsPage},
  {path: "/privacy", component: PrivacyPage},
  {path: "/csae", component: CsaePage},
  {path: "/:link/*", component: NostrLinkHandler},
  {path: "/:link", component: NostrLinkHandler},
]
