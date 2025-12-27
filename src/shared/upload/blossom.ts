import {NDKEvent} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_BLOSSOM_AUTH} from "@/utils/constants"
import {calculateSHA256} from "./utils"
import type {MediaServer} from "./types"

export async function uploadToBlossom(
  file: File,
  server: MediaServer,
  onProgress?: (progress: number) => void
): Promise<string> {
  const sha256 = await calculateSHA256(file)

  const url = `${server.url}/upload`

  // Create a Nostr event for authentication
  const currentTime = Math.floor(Date.now() / 1000)
  const event = new NDKEvent(ndk(), {
    kind: KIND_BLOSSOM_AUTH, // Blossom authorization event
    tags: [
      ["t", "upload"],
      ["x", sha256], // Required: SHA256 hash of the file
      ["expiration", (currentTime + 300).toString()], // Expires in 5 minutes
    ],
    content: file.name,
    created_at: currentTime,
  })
  await event.sign()
  const nostrEvent = await event.toNostrEvent()

  // Encode the event for the Authorization header
  const encodedEvent = btoa(JSON.stringify(nostrEvent))

  const headers = {
    accept: "application/json",
    authorization: `Nostr ${encodedEvent}`,
    "content-type": file.type,
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value)
    })

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percentComplete = (event.loaded / event.total) * 100
        onProgress(percentComplete)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.url) {
            resolve(data.url.replace("blossom.iris.to", "cdn.iris.to"))
          } else {
            reject(new Error(`URL not found in response from ${url}`))
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          reject(new Error(`Failed to parse response from ${url}: ${errorMessage}`))
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`))
      }
    }

    xhr.onerror = () => {
      reject(new Error(`Upload to ${url} failed`))
    }

    xhr.send(file)
  })
}
