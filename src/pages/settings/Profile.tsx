import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsInputItem} from "@/shared/components/settings/SettingsInputItem"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import useProfile, {updateProfileFromEvent} from "@/shared/hooks/useProfile"
import {useEffect, useId, useMemo, useState} from "react"
import {AppEvent, CacheMode} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "@/navigation"
import {nostr} from "@/utils/nostrClient"
import ProxyImg from "@/shared/components/ProxyImg"
import {
  profileEditorValues,
  readProfileMetadata,
  type ProfileEdits,
  type ProfileEditorField,
  type ProfileMetadata,
} from "./profileMetadata"

export function ProfileSettings() {
  const myPubKey = useUserStore((state) => state.publicKey)
  return myPubKey ? <ProfileSettingsEditor key={myPubKey} myPubKey={myPubKey} /> : null
}

function ProfileSettingsEditor({myPubKey}: {myPubKey: string}) {
  const navigate = useNavigate()
  const aboutId = useId()

  const profileUpload = useFileUpload({
    onUpload: (url: string) => setProfileField("picture", url),
    accept: "image/*",
  })

  const bannerUpload = useFileUpload({
    onUpload: (url: string) => setProfileField("banner", url),
    accept: "image/*",
  })

  const existingProfile = useProfile(myPubKey)
  const [source, setSource] = useState<{
    pubkey: string
    metadata: ProfileMetadata
    createdAt: number
  } | null>(null)
  const [edits, setEdits] = useState<ProfileEdits>({})
  const [loadError, setLoadError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const currentSource = source?.pubkey === myPubKey ? source : null
  const baseValues = useMemo(
    () => profileEditorValues(currentSource?.metadata ?? {}),
    [currentSource]
  )
  const newProfile = {...baseValues, ...edits}

  useEffect(() => {
    if (!myPubKey) return
    let cancelled = false
    setLoadError("")
    const accept = (data: NonNullable<ReturnType<typeof readProfileMetadata>>) => {
      if (cancelled) return
      setSource((current) =>
        current?.pubkey === myPubKey && current.createdAt > data.createdAt
          ? current
          : {pubkey: myPubKey, ...data}
      )
    }
    const cached = readProfileMetadata(existingProfile?.profileEvent, myPubKey)
    if (cached) {
      accept(cached)
      return
    }
    // A UI/cache projection is not a complete metadata document. Fetch the source
    // event before allowing edits to replace it, and fail closed if unavailable.
    void nostr()
      .fetchEvent({kinds: [0], authors: [myPubKey]}, {cacheUsage: CacheMode.ONLY_RELAY})
      .then((event) => {
        const data = readProfileMetadata(
          event ? JSON.stringify(event.rawEvent()) : undefined,
          myPubKey
        )
        if (!data) throw new Error("Profile source unavailable")
        accept(data)
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Couldn't load your full profile. Retry before saving.")
      })
    return () => {
      cancelled = true
    }
  }, [myPubKey, existingProfile?.profileEvent, loadAttempt])

  useEffect(() => {
    if (saveState === "saved") {
      const timer = setTimeout(() => setSaveState("idle"), 2000)
      return () => clearTimeout(timer)
    }
  }, [saveState])

  function setProfileField(field: ProfileEditorField, value: string) {
    setSaveState("idle")
    setEdits((prev) => {
      const next = {...prev}
      if (value === baseValues[field]) delete next[field]
      else next[field] = value
      return next
    })
  }

  async function onSaveProfile() {
    if (!currentSource || !myPubKey) return
    setSaveState("saving")
    setSaveError("")
    const savedEdits = edits
    const metadata = {...currentSource.metadata, ...savedEdits}
    try {
      const event = new AppEvent(nostr())
      event.kind = 0
      // Consecutive saves in the same second must replace the previous profile.
      event.created_at = Math.max(event.created_at, currentSource.createdAt + 1)
      event.content = JSON.stringify(metadata)
      const signer = nostr().signer
      if (!signer || (await signer.user()).pubkey !== myPubKey) {
        throw new Error("Profile signer changed")
      }
      // Metadata strings are data, not post text to rewrite into Nostr mentions.
      await event.sign(signer, {skipContentTagging: true})
      await event.publish()
      updateProfileFromEvent(event)
      setSource((current) =>
        current && current.createdAt > (event.created_at ?? 0)
          ? current
          : {pubkey: myPubKey, metadata, createdAt: event.created_at ?? 0}
      )
      setEdits((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key, value]) => savedEdits[key as ProfileEditorField] !== value
          )
        )
      )
      setSaveState("saved")
    } catch {
      setSaveState("idle")
      setSaveError("Couldn't save your profile. Your changes are still here; try again.")
    }
  }

  const isEdited = Object.keys(edits).length > 0

  const getUploadButtonLabel = (upload: typeof profileUpload, defaultLabel: string) => {
    if (upload.uploading) {
      return `Uploading... ${upload.progress}%`
    }
    if (upload.error) {
      return `Upload failed: ${upload.error}`
    }
    return defaultLabel
  }

  if (!myPubKey) {
    return null
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="flex flex-col items-center mb-6">
          <div className="mb-4">
            <Avatar
              width={128}
              pubKey={myPubKey || ""}
              showBadge={false}
              showTooltip={false}
            />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-semibold">
              <Name pubKey={myPubKey} />
            </h2>
            {(newProfile?.nip05 || existingProfile?.nip05) && (
              <p className="text-base-content/70 text-sm">
                {newProfile?.nip05 || existingProfile?.nip05}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {loadError && (
            <div role="alert">
              <p>{loadError}</p>
              <button
                className="btn btn-sm"
                onClick={() => setLoadAttempt((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {saveError && <p role="alert">{saveError}</p>}
          {!currentSource && !loadError && <p>Loading your full profile…</p>}
          <fieldset
            className="space-y-6"
            disabled={!currentSource || saveState === "saving"}
          >
            <SettingsGroup title="Personal Information">
              <SettingsInputItem
                label="Name"
                modified={edits.display_name !== undefined}
                value={String(newProfile?.display_name || "")}
                placeholder="Your name"
                onChange={(value) => setProfileField("display_name", value)}
              />

              <SettingsGroupItem
                className={edits.about !== undefined ? "bg-primary/10" : ""}
              >
                <div className="flex flex-col space-y-2">
                  <label
                    htmlFor={aboutId}
                    className="flex items-center gap-2 text-base font-normal"
                  >
                    About
                    {edits.about !== undefined && (
                      <span id={`${aboutId}-modified`} className="text-xs text-primary">
                        Unsaved
                      </span>
                    )}
                  </label>
                  <textarea
                    id={aboutId}
                    aria-describedby={
                      edits.about !== undefined ? `${aboutId}-modified` : undefined
                    }
                    placeholder="About yourself"
                    className="bg-transparent border-none p-0 text-base focus:outline-none placeholder:text-base-content/40 resize-none min-h-[4em] w-full"
                    value={newProfile?.about || ""}
                    onChange={(e) => setProfileField("about", e.target.value)}
                  />
                </div>
              </SettingsGroupItem>

              <SettingsInputItem
                label="Website"
                modified={edits.website !== undefined}
                value={newProfile?.website || ""}
                placeholder="https://example.com"
                onChange={(value) => setProfileField("website", value)}
                type="url"
                isLast
              />
            </SettingsGroup>

            <SettingsGroup title="Profile Picture">
              <SettingsInputItem
                label="Image URL"
                modified={edits.picture !== undefined}
                value={newProfile?.picture || ""}
                placeholder="https://example.com/image.jpg"
                onChange={(value) => setProfileField("picture", value)}
                type="url"
              />

              {newProfile?.picture && (
                <SettingsGroupItem>
                  <div className="w-10 h-10 rounded-full overflow-hidden">
                    <ProxyImg
                      src={newProfile.picture}
                      alt="Profile preview"
                      className="w-full h-full object-cover"
                      width={40}
                      square={true}
                    />
                  </div>
                </SettingsGroupItem>
              )}

              <SettingsButton
                label={getUploadButtonLabel(profileUpload, "Upload Profile Picture")}
                onClick={profileUpload.triggerUpload}
                disabled={profileUpload.uploading}
                variant={profileUpload.error ? "destructive" : "default"}
                isLast
              />
            </SettingsGroup>

            <SettingsGroup title="Banner Image">
              <SettingsInputItem
                label="Image URL"
                modified={edits.banner !== undefined}
                value={newProfile?.banner || ""}
                placeholder="https://example.com/banner.jpg"
                onChange={(value) => setProfileField("banner", value)}
                type="url"
              />

              {newProfile?.banner && (
                <SettingsGroupItem>
                  <div className="w-16 h-8 rounded overflow-hidden">
                    <ProxyImg
                      src={newProfile.banner}
                      alt="Banner preview"
                      className="w-full h-full object-cover"
                      width={64}
                    />
                  </div>
                </SettingsGroupItem>
              )}

              <SettingsButton
                label={getUploadButtonLabel(bannerUpload, "Upload Banner Image")}
                onClick={bannerUpload.triggerUpload}
                disabled={bannerUpload.uploading}
                variant={bannerUpload.error ? "destructive" : "default"}
                isLast
              />
            </SettingsGroup>

            <SettingsGroup title="Verification & Payment">
              <SettingsInputItem
                label="Lightning Address"
                modified={edits.lud16 !== undefined}
                value={newProfile?.lud16 || ""}
                placeholder="user@wallet.com"
                onChange={(value) => setProfileField("lud16", value)}
                type="email"
              />

              <SettingsInputItem
                label="user@domain verification (NIP-05)"
                modified={edits.nip05 !== undefined}
                value={newProfile?.nip05 || ""}
                placeholder="user@example.com"
                onChange={(value) => setProfileField("nip05", value)}
                type="email"
              />

              <SettingsButton
                label="Get free username @ iris.to"
                onClick={() => navigate("/settings/iris")}
                isLast
              />
            </SettingsGroup>
          </fieldset>
        </div>
        {(isEdited || saveState !== "idle") && (
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 z-20 -mx-4 mt-6 flex items-center justify-between gap-4 bg-base-200 p-4">
            <p role="status" className="text-sm text-base-content/70">
              {
                {idle: "Unsaved changes", saving: "Saving…", saved: "Changes saved"}[
                  saveState
                ]
              }
            </p>
            <button
              className="btn btn-primary"
              onClick={onSaveProfile}
              disabled={
                !currentSource ||
                !isEdited ||
                saveState === "saving" ||
                profileUpload.uploading ||
                bannerUpload.uploading
              }
            >
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
