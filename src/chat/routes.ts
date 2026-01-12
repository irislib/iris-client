import {lazy} from "react"
import {RouteDefinition} from "@/navigation/types"

// Lazy load chat components
const ChatsPage = lazy(() => import("@/pages/chats"))
const SettingsPage = lazy(() => import("@/pages/settings"))

// Chat-only routes - minimal set for the delegate chat app
export const chatRoutes: RouteDefinition[] = [
  {path: "/", component: ChatsPage, alwaysKeep: true},
  {path: "/chats/*", component: ChatsPage},
  {path: "/settings/*", component: SettingsPage},
]
