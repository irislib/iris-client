import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {CashuSeedBackup} from "@/shared/components/settings/CashuSeedBackup"
import CopyButton from "@/shared/components/button/CopyButton"
import {hexToBytes} from "@noble/hashes/utils.js"
import {useUserStore} from "@/stores/user"
import {nip19} from "nostr-tools"

function Keys() {
  const privateKey = useUserStore((state) => state.privateKey)

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Secret key">
            {privateKey ? (
              <>
                <SettingsGroupItem>
                  <div className="flex flex-col space-y-1">
                    <CopyButton
                      copyStr={() => nip19.nsecEncode(hexToBytes(privateKey))}
                      text="Copy secret key (nsec)"
                      className="text-info text-left"
                    />
                    <span className="text-xs text-base-content/60">
                      Copy and securely store your secret key. Keep this safe and never
                      share it.
                    </span>
                  </div>
                </SettingsGroupItem>
                <SettingsGroupItem isLast>
                  <div className="flex flex-col space-y-1">
                    <CopyButton
                      copyStr={privateKey}
                      text="Copy hex private key"
                      className="text-info text-left"
                    />
                    <span className="text-xs text-base-content/60">
                      Raw hexadecimal format for advanced use cases.
                    </span>
                  </div>
                </SettingsGroupItem>
              </>
            ) : (
              <SettingsGroupItem isLast>
                <div className="text-center py-4 text-base-content/70">
                  No private key available to backup.
                </div>
              </SettingsGroupItem>
            )}
          </SettingsGroup>

          <SettingsGroup title="Cashu wallet">
            <SettingsGroupItem isLast>
              <CashuSeedBackup />
            </SettingsGroupItem>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default Keys
