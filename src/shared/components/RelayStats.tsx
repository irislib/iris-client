import {Link} from "@/navigation"
import {useUserStore} from "@/stores/user"
import {RelayList} from "./RelayList"
import Widget from "@/shared/components/ui/Widget"
import {useWorkerRelayStatus} from "@/shared/hooks/useWorkerRelayStatus"

interface RelayStatsProps {
  background?: boolean
}

export function RelayStats({background = true}: RelayStatsProps = {}) {
  const {relayConfigs} = useUserStore()
  const {relays} = useWorkerRelayStatus()
  const connectedRelayUrls = new Set(
    relays
      .filter((relay) => relay.status >= 5)
      .map((relay) => relay.url.replace(/\/$/, ""))
  )

  const connectedCount =
    relayConfigs?.filter((config) => {
      return !config.disabled && connectedRelayUrls.has(config.url.replace(/\/$/, ""))
    }).length || 0

  const totalEnabled = relayConfigs?.filter((c) => !c.disabled).length || 0

  return (
    <Widget title={false} background={background} className="h-auto">
      <div className="p-3">
        <Link to="/settings/network" className="inline-block mb-2">
          <h3 className="font-semibold text-sm opacity-80 hover:opacity-100 cursor-pointer transition-opacity underline decoration-dotted underline-offset-2">
            Network ({connectedCount}/{totalEnabled})
          </h3>
        </Link>
        <RelayList
          compact={true}
          showDelete={true}
          showAddRelay={true}
          showDiscovered={true}
          itemClassName="hover:opacity-100 transition-opacity group"
        />
      </div>
    </Widget>
  )
}
