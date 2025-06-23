import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {getSubscriptionIcon} from "@/shared/utils/subscriptionIcons"
import {MouseEventHandler, useEffect, useState} from "react"
import Icon from "@/shared/components/Icons/Icon"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import NavLink from "./NavLink"

interface SubscriptionNavItemProps {
  to: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export const SubscriptionNavItem = ({to, onClick}: SubscriptionNavItemProps) => {
  const {setIsSidebarOpen} = useUIStore()
  const [pubkey, setPubkey] = useState<string | undefined>(undefined)
  const {isSubscriber, tier} = useSubscriptionStatus(pubkey)

  useEffect(() => {
    // Get the user's pubkey from zustand store instead of localStorage
    const userStore = useUserStore.getState()
    if (userStore.publicKey) {
      setPubkey(userStore.publicKey)
    }

    const unsubscribe = useUserStore.subscribe((state, prevState) => {
      if (state.publicKey && state.publicKey !== prevState.publicKey) {
        setPubkey(state.publicKey)
      }
    })

    return () => unsubscribe()
  }, [])

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    setIsSidebarOpen(false)
    onClick?.(e)
  }

  return (
    <li>
      <NavLink
        title="Subscription"
        to={to}
        onClick={handleClick}
        className={({isActive}) =>
          classNames({
            "bg-base-100": isActive,
            "rounded-full md:aspect-square xl:aspect-auto flex items-center": true,
          })
        }
      >
        {({isActive}) => (
          <span className="indicator flex items-center gap-2">
            {isSubscriber ? (
              getSubscriptionIcon(tier, "w-6 h-6")
            ) : (
              <Icon
                name={isActive ? "heart-solid" : "heart"}
                className="w-6 h-6 text-base-content"
              />
            )}
            <span className="inline md:hidden xl:inline">Subscription</span>
          </span>
        )}
      </NavLink>
    </li>
  )
}
