import {
  attachGroupTransportListener,
  cleanupGroupTransportListener,
} from "@/utils/groupTransport"

export const cleanupGroupMessageListener = () => {
  cleanupGroupTransportListener()
}

export const attachGroupMessageListener = () => {
  attachGroupTransportListener()
}
