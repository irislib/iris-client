import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsInputItem} from "@/shared/components/settings/SettingsInputItem"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import useProfile, {updateProfileFromEvent} from "@/shared/hooks/useProfile"
import {useEffect, useId, useMemo, useRef, useState} from "react"
import {
  buildRawProfileDraft,
  conflictingRawProfileFields,
  diffRawProfileFields,
  readRawProfileFields,
  readProfileFields,
  formatRawProfileFields,
} from "@iris/profile-events"
import type {Event} from "nostr-tools/pure"
import {nip19} from "nostr-tools"
import {AppEvent} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "@/navigation"
import {nostr} from "@/utils/nostrClient"
import {watchLatestEvent} from "@/utils/watchLatestEvent"
import ProxyImg from "@/shared/components/ProxyImg"
import {
  customProfileFields,
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
  const canBackUpKey = useUserStore((state) => Boolean(state.privateKey))
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
  type Source = {metadata: ProfileMetadata; event: Event | null}
  const [source, setSource] = useState<Source | null>(null)
  const latest = useRef<Source | null>(null)
  const [draftBase, setDraftBase] = useState<Source | null>(null)
  const [customText, setCustomText] = useState<string | null>(null)
  const [edits, setEdits] = useState<ProfileEdits>({})
  const [loadError, setLoadError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const currentSource = draftBase ?? source
  const baseValues = useMemo(
    () => profileEditorValues(currentSource?.metadata ?? {}),
    [currentSource]
  )
  const newProfile = {...baseValues, ...edits}
  const npubCashAddress = `${nip19.npubEncode(myPubKey)}@npub.cash`

  const initialCustom = useMemo(
    () =>
      customProfileFields(readRawProfileFields(currentSource?.event?.content ?? "{}")),
    [currentSource]
  )
  let customPatch: Record<string, string | undefined> = {}
  let customError = ""
  if (customText !== null) {
    try {
      const object = readRawProfileFields(customText)
      if (Object.keys(object).some((key) => Object.hasOwn(baseValues, key))) throw Error()
      customPatch = diffRawProfileFields(initialCustom, object)
    } catch {
      customError = "Enter a JSON object using keys outside the main form."
    }
  }

  function accept(data: Source) {
    const previous = latest.current?.event
    if (
      previous &&
      (!data.event ||
        previous.created_at > data.event.created_at ||
        (previous.created_at === data.event.created_at && previous.id <= data.event.id))
    )
      return
    latest.current = data
    setSource(data)
    setLoadError("")
  }

  useEffect(() => {
    let cancelled = false
    const cached = readProfileMetadata(existingProfile?.profileEvent, myPubKey)
    if (cached) accept(cached)
    const stop = watchLatestEvent(
      {kinds: [0], authors: [myPubKey]},
      (event) => {
        const data = readProfileMetadata(JSON.stringify(event.rawEvent()), myPubKey)
        if (cancelled) return
        if (data) accept(data)
        else if (
          !latest.current?.event ||
          event.created_at >= latest.current.event.created_at
        ) {
          setLoadError("Your latest profile could not be read. Retry before saving.")
        }
      },
      {},
      ({found, complete}) => {
        if (found || cancelled) return
        if (complete) accept({metadata: {}, event: null})
        else if (!latest.current)
          setLoadError("Couldn't load your full profile. Retry before saving.")
      }
    )
    return () => {
      cancelled = true
      stop()
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
    setDraftBase(currentSource)
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
    const savedEdits = {
      ...Object.fromEntries(
        Object.entries(edits).map(([key, value]) => [key, JSON.stringify(value)])
      ),
      ...customPatch,
    }
    const head = latest.current
    if (!head || customError || loadError) {
      setSaveState("idle")
      return
    }
    try {
      const conflicts = conflictingRawProfileFields(
        readRawProfileFields(currentSource.event?.content ?? "{}"),
        readRawProfileFields(head.event?.content ?? "{}"),
        savedEdits
      )
      if (conflicts.length)
        throw Error(
          `Changed elsewhere: ${conflicts.join(", ")}. Load the latest profile to review these changes.`
        )
      const event = new AppEvent(nostr(), buildRawProfileDraft(head.event, savedEdits))
      const signer = nostr().signer
      if (!signer || (await signer.user()).pubkey !== myPubKey) {
        throw new Error("Profile signer changed")
      }
      // Metadata strings are data, not post text to rewrite into Nostr mentions.
      await event.sign(signer, {preserveTags: true})
      if (latest.current?.event?.id !== head.event?.id)
        throw Error(
          "Your profile changed while signing. Review your edits and save again."
        )
      await event.publish()
      updateProfileFromEvent(event)
      accept({metadata: readProfileFields(event.content), event: event.rawEvent()})
      setDraftBase(null)
      setEdits({})
      setCustomText(null)
      setSaveState("saved")
    } catch (error) {
      setSaveState("idle")
      setSaveError(
        error instanceof Error
          ? error.message
          : "Couldn't save your profile. Your changes are still here; try again."
      )
    }
  }

  const changedKeys = [...Object.keys(edits), ...Object.keys(customPatch)]
  const isEdited = changedKeys.length > 0
  useEffect(() => {
    if (!isEdited && !customError && saveState === "idle" && draftBase) {
      setDraftBase(null)
      setCustomText(null)
    }
  }, [isEdited, customError, saveState, draftBase])

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
          {canBackUpKey && (
            <SettingsGroup title="This device">
              <SettingsButton
                label="Back up secret key"
                onClick={() => navigate("/settings/keys")}
                isLast
              />
            </SettingsGroup>
          )}
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

              {!newProfile.lud16.trim() && (
                <SettingsGroupItem
                  className="break-all text-sm text-info"
                  onClick={() => setProfileField("lud16", npubCashAddress)}
                >
                  Use {npubCashAddress}
                </SettingsGroupItem>
              )}

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
            <details className="rounded-box bg-base-100 p-4">
              <summary className="cursor-pointer">Custom fields and tags</summary>
              <label className="mt-4 grid gap-1 text-sm">
                Custom fields (JSON)
                <textarea
                  className="textarea w-full font-mono"
                  rows={5}
                  spellCheck={false}
                  value={customText ?? formatRawProfileFields(initialCustom)}
                  onChange={(event) => {
                    setDraftBase(currentSource)
                    setCustomText(event.target.value)
                    setSaveState("idle")
                  }}
                />
              </label>
              {customError && <p role="alert">{customError}</p>}
              {Object.keys(customPatch).length > 0 && (
                <dl aria-label="Custom field changes" className="mt-2 grid gap-2 text-sm">
                  {Object.entries(customPatch).map(([key, after]) => (
                    <div key={key}>
                      <dt className="font-medium">{key}</dt>
                      <dd className="break-all">
                        Before · {initialCustom[key] ?? "Absent"}
                      </dd>
                      <dd className="break-all">After · {after ?? "Absent"}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {Boolean(currentSource?.event?.tags.length) && (
                <p className="mt-3 text-sm">Event tags</p>
              )}
              {currentSource?.event?.tags.map((tag, index) => (
                <code key={index} className="block break-all text-xs">
                  {JSON.stringify(tag)}
                </code>
              ))}
            </details>
            {isEdited && (
              <p className="text-sm break-words">Changes: {changedKeys.join(", ")}</p>
            )}
            {draftBase && draftBase.event?.id !== source?.event?.id && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setDraftBase(null)
                  setEdits({})
                  setCustomText(null)
                  setSaveError("")
                }}
              >
                Discard edits and load latest
              </button>
            )}
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
                !!customError ||
                !!loadError ||
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
