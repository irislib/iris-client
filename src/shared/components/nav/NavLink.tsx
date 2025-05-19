import {NavLink as RouterNavLink, NavLinkProps, useLocation} from "react-router"
import {useNotificationsStore} from "@/stores/notifications"
import {MouseEvent} from "react"

export default function NavLink(props: NavLinkProps) {
  const {to, onClick, ...rest} = props
  const location = useLocation()

  const isActive = location.pathname === to.toString()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onClick) {
      onClick(event)
    }

    if (isActive) {
      if (window.scrollY === 0) {
        const {incrementRefreshRouteSignal} = useNotificationsStore.getState()
        incrementRefreshRouteSignal()
      } else {
        window.scrollTo({top: 0, behavior: "instant"})
      }
    }
  }

  return <RouterNavLink to={to} onClick={handleClick} {...rest} />
}
