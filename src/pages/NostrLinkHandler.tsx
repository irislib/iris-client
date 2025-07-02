import {CLOUDFLARE_CSAM_FLAGGED} from "@/utils/cloudflare_banned_users"
import {hexToBytes, bytesToHex} from "@noble/hashes/utils"
import {useParams, Link} from "react-router"
import {sha256} from "@noble/hashes/sha256"
import {useEffect, useState} from "react"
import {nip05, nip19} from "nostr-tools"
import {Page404} from "@/pages/Page404"
import ThreadPage from "@/pages/thread"
import ProfilePage from "@/pages/user"

const CLOUDFLARE_CSAM_EXPLANATION_NOTE =
  "note1pu5kvxwfzytxsw6vkqd4eu6e0xr8znaur6sl38r4swl3klgsn6dqzlpnsl"
const CLOUDFLARE_CSAM_MESSAGE = "Flagged as CSAM by Cloudflare. See explanation at"

export default function NostrLinkHandler() {
  const {link} = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [pubkey, setPubkey] = useState<string>()
  const [naddrData, setNaddrData] = useState<{
    pubkey: string
    kind: number
    identifier: string
  }>()

  const isProfile = link?.startsWith("npub") || link?.startsWith("nprofile")
  const isNote = link?.startsWith("note") || link?.startsWith("nevent")
  const isAddress = link?.startsWith("naddr")

  useEffect(() => {
    setLoading(true)
    setError(undefined)
    setPubkey(undefined)
    setNaddrData(undefined)

    const resolveLink = async () => {
      if (!link) {
        setLoading(false)
        return
      }

      try {
        if (isProfile) {
          const decoded = nip19.decode(link)
          if (
            typeof decoded.data === "object" &&
            decoded.data !== null &&
            "pubkey" in decoded.data
          ) {
            setPubkey(decoded.data.pubkey)
          } else if (typeof decoded.data === "string" && decoded.data.length === 64) {
            setPubkey(decoded.data)
          } else {
            setLoading(false)
            return
          }
        } else if (isAddress) {
          const decoded = nip19.decode(link)
          const data = decoded.data as {pubkey: string; kind: number; identifier: string}
          setNaddrData(data)
        } else if (link.includes("@") || !isNote) {
          // Try exact match first
          let resolved = await nip05.queryProfile(link)

          // If not found and doesn't include @iris.to, try with @iris.to
          if (!resolved && !link.includes("@iris.to")) {
            const withIris = `${link}@iris.to`
            resolved = await nip05.queryProfile(withIris)
          }

          if (!resolved) {
            setLoading(false)
            return
          }
          setPubkey(resolved.pubkey)
          setLoading(false)
          return
        }
      } catch (err) {
        console.error("Resolution error:", err)
        setLoading(false)
        return
      }
      setLoading(false)
    }

    resolveLink()
  }, [link])

  useEffect(() => {
    if (pubkey && (isProfile || !isNote)) {
      const hash = bytesToHex(sha256(hexToBytes(pubkey)))
      if (CLOUDFLARE_CSAM_FLAGGED.includes(hash)) {
        setError(`${CLOUDFLARE_CSAM_MESSAGE} /${CLOUDFLARE_CSAM_EXPLANATION_NOTE}`)
      }
    }
  }, [pubkey, isProfile, isNote])

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <section className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="max-w-md">
            <h1 className="text-5xl font-bold text-primary mb-2">Error</h1>
            <p className="text-xl mb-8">
              {CLOUDFLARE_CSAM_MESSAGE}{" "}
              <Link
                to={`/${CLOUDFLARE_CSAM_EXPLANATION_NOTE}`}
                className="link link-primary"
              >
                {CLOUDFLARE_CSAM_EXPLANATION_NOTE}
              </Link>
            </p>
            <button
              onClick={() => (window.location.href = "/")}
              className="btn btn-primary btn-lg"
            >
              Go back to homepage
            </button>
          </div>
        </div>
      </section>
    )
  }

  if ((isProfile || !isNote) && pubkey) {
    return <ProfilePage pubKey={pubkey} />
  }

  if (isNote) {
    return <ThreadPage id={link!} />
  }

  if (isAddress && naddrData) {
    return <ThreadPage id={link!} isNaddr={true} naddrData={naddrData} />
  }

  return <Page404 />
}
