import {Statistics} from "./Statistics"
import {FileOperations} from "./FileOperations"
import {Maintenance} from "./Maintenance"
import {DownloadParameters} from "./DownloadParameters"
import {TopUsers} from "./TopUsers"

function SocialGraphSettings() {
  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <Statistics />
          <Maintenance />
          <FileOperations />
          <DownloadParameters />
          <TopUsers />
        </div>
      </div>
    </div>
  )
}

export default SocialGraphSettings
