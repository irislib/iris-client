import type {RTCSessionDescriptionInit, RTCIceCandidateInit} from "@/types/dom-types"
import {EventEmitter} from "tseep"

import {getCachedName, NDKEventFromRawEvent} from "@/utils/nostr"
import {Rumor, Session} from "nostr-double-ratchet/src"
import {useSessionsStore} from "@/stores/sessions"
import socialGraph from "@/utils/socialGraph"

const connections = new Map<string, PeerConnection>()
export function getPeerConnection(
  sessionId: string,
  options: {
    ask?: boolean
    connect?: boolean
    create?: boolean
  } = {}
) {
  const {ask = true, connect = false, create = true} = options
  const pubKey = sessionId.split(":")[0]
  if (
    create &&
    socialGraph().getFollowDistance(pubKey) > 1 &&
    socialGraph().getRoot() !== pubKey
  ) {
    console.log("Rejected connection request from untrusted user:", pubKey)
    return
  }
  if (
    !connections.has(sessionId) &&
    create &&
    (pubKey === socialGraph().getRoot() ||
      !ask ||
      confirm(`WebRTC connect with ${getCachedName(pubKey)}?`))
  ) {
    const session = useSessionsStore.getState().sessions.get(sessionId)
    if (!session) {
      console.error("Session not found for peer:", sessionId)
      return
    }
    const connection = new PeerConnection(session, sessionId)
    connections.set(sessionId, connection)
    if (connect) {
      connection?.connect()
    }
    return connection
  }
  return connections.get(sessionId)
}

export default class PeerConnection extends EventEmitter {
  peerId: string
  session: Session
  peerConnection: RTCPeerConnection
  dataChannel: RTCDataChannel | null
  fileChannel: RTCDataChannel | null
  incomingFileMetadata: {name: string; size: number; type: string} | null = null
  receivedFileData: ArrayBuffer[] = []
  receivedFileSize: number = 0

  constructor(session: Session, peerId?: string) {
    super()
    this.peerId = peerId || Math.random().toString(36).substring(2, 8)
    this.session = session
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{urls: "stun:stun.l.google.com:19302"}],
    })
    this.dataChannel = null
    this.fileChannel = null
    this.setupPeerConnectionEvents()
  }

  log(...args: unknown[]) {
    console.log(this.peerId, ...args)
  }

  connect() {
    const state = this.peerConnection.connectionState
    if (state !== "connected" && state !== "connecting") {
      this.sendOffer()
    }
  }

  handleEvent(event: Rumor) {
    this.log("Received event:", event)
    if (event.kind !== 30078) return

    const typeTag = event.tags.find((tag) => tag[0] === "type")
    const webrtcTag = event.tags.find((tag) => tag[0] === "l" && tag[1] === "webrtc")
    const content = event.content

    if (!typeTag || !content || !webrtcTag) {
      this.log("Missing required tags or content:", {
        hasTypeTag: !!typeTag,
        hasWebrtcTag: !!webrtcTag,
        hasContent: !!content,
      })
      return
    }

    this.log("Processing WebRTC message type:", typeTag[1], "with content:", content)

    try {
      const parsedContent = JSON.parse(content)
      switch (typeTag[1]) {
        case "offer":
          this.log("Received offer, handling...")
          this.handleOffer(parsedContent)
          break
        case "answer":
          this.log("Received answer, handling...")
          this.handleAnswer(parsedContent)
          break
        case "candidate":
          this.log("Received ICE candidate")
          this.handleCandidate(parsedContent)
          break
        default:
          console.error("Unknown message type:", typeTag[1])
      }
    } catch (e) {
      console.error("Error processing WebRTC message:", e)
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    this.send({
      kind: 30078,
      tags: [
        ["l", "webrtc"],
        ["type", "answer"],
      ],
      content: JSON.stringify(answer),
    })
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
  }

  async handleCandidate(candidate: RTCIceCandidateInit) {
    if (this.peerConnection.remoteDescription === null) {
      // Queue the candidate to be added after remote description is set
      this.log("Remote description not set yet, queuing candidate")
      setTimeout(() => this.handleCandidate(candidate), 500)
      return
    }
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
  }

  setupPeerConnectionEvents() {
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({
          kind: 30078,
          content: JSON.stringify(event.candidate),
          tags: [
            ["l", "webrtc"],
            ["type", "candidate"],
          ],
        })
      }
    }

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel
      if (channel.label.startsWith("fileChannel")) {
        this.setFileChannel(channel)
      } else {
        this.setDataChannel(channel)
      }
    }

    this.peerConnection.onconnectionstatechange = () => {
      this.log("Connection state:", this.peerConnection.connectionState)
      if (this.peerConnection.connectionState === "closed") {
        this.log(`${this.peerId} connection closed`)
        this.close()
      }
    }
  }

  async sendOffer() {
    this.dataChannel = this.peerConnection.createDataChannel("jsonChannel")
    this.setDataChannel(this.dataChannel)
    this.fileChannel = this.peerConnection.createDataChannel("fileChannel")
    this.setFileChannel(this.fileChannel)
    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)
    this.send({
      kind: 30078,
      tags: [
        ["l", "webrtc"],
        ["type", "offer"],
      ],
      content: JSON.stringify(offer),
    })
    this.log("Sent offer:", offer)
  }

  async sendAnswer(offer: RTCSessionDescriptionInit) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    this.send({
      kind: 30078,
      tags: [
        ["l", "webrtc"],
        ["type", "answer"],
      ],
      content: JSON.stringify(answer),
    })
    console.log("Sent answer:", answer)
  }

  private send(eventData: Partial<Rumor>) {
    eventData.tags?.push([
      "expiration",
      (Math.floor(Date.now() / 1000) + 5 * 60).toString(),
    ])
    const {event} = this.session.sendEvent(eventData)
    NDKEventFromRawEvent(event).publish()
    this.log("Sent event:", eventData)
    return event
  }

  setDataChannel(dataChannel: RTCDataChannel) {
    this.dataChannel = dataChannel
    this.dataChannel.onopen = () => this.log("Data channel is open")
    this.dataChannel.onmessage = (event) => {
      this.log("Received message:", event.data)
    }
    this.dataChannel.onclose = () => {
      this.log("Data channel is closed")
      this.close()
    }
  }

  setFileChannel(fileChannel: RTCDataChannel) {
    this.fileChannel = fileChannel
    this.fileChannel.binaryType = "arraybuffer"
    this.fileChannel.onopen = () => this.log("File channel is open")
    this.fileChannel.onmessage = (event) => {
      this.log("File channel received message:", event.data)
      if (typeof event.data === "string") {
        const metadata = JSON.parse(event.data)
        if (metadata.type === "file-metadata") {
          this.incomingFileMetadata = metadata.metadata
          this.receivedFileData = []
          this.receivedFileSize = 0
          this.log("Received file metadata:", this.incomingFileMetadata)
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.receivedFileData.push(event.data)
        this.receivedFileSize += event.data.byteLength
        this.log("Received file chunk:", event.data.byteLength, "bytes")
        this.log("Total received size:", this.receivedFileSize, "bytes")

        if (this.incomingFileMetadata) {
          this.log("Expected file size:", this.incomingFileMetadata.size, "bytes")
          if (this.receivedFileSize === this.incomingFileMetadata.size) {
            this.log("File fully received, saving file...")
            this.saveReceivedFile()
          } else {
            this.log("File not fully received, waiting...")
          }
        } else {
          console.error("No file metadata available")
        }
      }
    }
    this.fileChannel.onclose = () => {
      this.log("File channel is closed")
    }
  }

  async saveReceivedFile() {
    if (!this.incomingFileMetadata) {
      console.error("No file metadata available")
      return
    }

    const pubkey = this.peerId.split(":")[0]
    const name = getCachedName(pubkey)
    const confirmString = `Save ${this.incomingFileMetadata.name} from ${name}?`
    if (!confirm(confirmString)) {
      this.log("User did not confirm file save")
      this.incomingFileMetadata = null
      this.receivedFileData = []
      this.receivedFileSize = 0
      return
    }

    this.log("Saving file with metadata:", this.incomingFileMetadata)
    this.log("Total received file data size:", this.receivedFileSize)

    const blob = new Blob(this.receivedFileData, {type: this.incomingFileMetadata.type})
    this.log("Created Blob:", blob)

    const url = URL.createObjectURL(blob)
    this.log("Created Object URL:", url)

    const a = document.createElement("a")
    a.href = url
    a.download = this.incomingFileMetadata.name
    document.body.appendChild(a)
    this.log("Appended anchor element to body:", a)

    a.click()
    this.log("Triggered download")

    document.body.removeChild(a)
    this.log("Removed anchor element from body")

    URL.revokeObjectURL(url)
    this.log("Revoked Object URL")

    // Reset file data
    this.incomingFileMetadata = null
    this.receivedFileData = []
    this.receivedFileSize = 0
    this.log("Reset file data")
  }

  sendJsonData(jsonData: unknown) {
    if (this.dataChannel?.readyState === "open") {
      const jsonString = JSON.stringify(jsonData)
      this.dataChannel.send(jsonString)
    }
  }

  sendFile(file: File) {
    if (this.peerConnection.connectionState === "connected") {
      // Create a unique file channel name
      const fileChannelName = `fileChannel-${Date.now()}`
      const fileChannel = this.peerConnection.createDataChannel(fileChannelName)
      this.setFileChannel(fileChannel)

      // Send file metadata over the file channel
      const metadata = {
        type: "file-metadata",
        metadata: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
      }
      fileChannel.onopen = () => {
        this.log("File channel is open, sending metadata")
        fileChannel.send(JSON.stringify(metadata))

        // Read and send the file as binary data
        const reader = new FileReader()
        reader.onload = () => {
          if (reader.result && reader.result instanceof ArrayBuffer) {
            fileChannel.send(reader.result)
          }
        }
        reader.readAsArrayBuffer(file)
      }
    } else {
      console.error("Peer connection is not connected")
    }
  }

  close() {
    if (this.dataChannel) {
      this.dataChannel.close()
    }
    if (this.fileChannel) {
      this.fileChannel.close()
    }
    this.peerConnection.close()
    this.emit("close")
  }
}
