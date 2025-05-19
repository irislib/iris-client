import {MouseEvent, ReactNode, useState, memo} from "react"
import reactStringReplace from "react-string-replace"
import {useSettingsStore} from "@/stores/settings"
import {NDKEvent} from "@nostr-dev-kit/ndk"

import {allEmbeds, smallEmbeds} from "./embed"

const HyperText = memo(
  ({
    children,
    event,
    small,
    truncate,
    expandable = true,
    textPadding = !small,
  }: {
    children: string
    event?: NDKEvent
    small?: boolean
    truncate?: number
    expandable?: boolean
    textPadding?: boolean
  }) => {
    const [isExpanded, setIsExpanded] = useState(false)
    const content = children.trim()
    const settings = useSettingsStore()

    const toggleShowMore = (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      setIsExpanded(!isExpanded)
    }

    let processedChildren: Array<ReactNode | string> = [content]
    const embeds = small ? smallEmbeds : allEmbeds

    // Process embeds
    embeds.forEach((embed) => {
      if (
        embed.settingsKey &&
        settings.content &&
        settings.content.hideEventsByUnknownUsers === false
      )
        return
      processedChildren = reactStringReplace(
        processedChildren,
        embed.regex,
        (match, i) => (
          <embed.component
            match={match}
            index={i}
            event={event}
            key={`${embed.settingsKey}-${i}${embed.inline ? "-inline" : ""}`}
          />
        )
      )
    })

    // Handle truncation
    let charCount = 0
    if (truncate && !isExpanded) {
      let isTruncated = false
      const truncatedChildren = processedChildren.reduce(
        (acc: Array<ReactNode | string>, child) => {
          if (typeof child === "string") {
            if (charCount + child.length > truncate) {
              acc.push(child.substring(0, truncate - charCount))
              isTruncated = true
              return acc
            }
            charCount += child.length
          }
          acc.push(child)
          return acc
        },
        [] as Array<ReactNode | string>
      )

      processedChildren = truncatedChildren
      if (isTruncated && expandable) {
        processedChildren.push(
          <span key="show-more">
            ...{" "}
            <a href="#" onClick={toggleShowMore} className="text-info underline">
              show more
            </a>
          </span>
        )
      }
    }

    // Add show less button when expanded
    if (isExpanded) {
      processedChildren.push(
        <span key="show-less">
          {" "}
          <a href="#" onClick={toggleShowMore} className="text-info underline">
            show less
          </a>
        </span>
      )
    }

    processedChildren = processedChildren.map((x, index) => {
      if (x === "" && index > 0) x = " "
      return x
    })

    // Group consecutive inline elements and strings
    const groupedChildren: ReactNode[] = []
    let currentGroup: ReactNode[] = []
    let groupCounter = 0

    processedChildren.forEach((child) => {
      const isInline =
        typeof child === "string" ||
        (child &&
          typeof child === "object" &&
          "key" in child &&
          child.key?.includes("-inline"))

      if (isInline) {
        currentGroup.push(child)
      } else {
        if (currentGroup.length > 0) {
          groupedChildren.push(
            <div
              key={`inline-group-${groupCounter++}`}
              className={textPadding ? "px-4" : ""}
            >
              {currentGroup}
            </div>
          )
          currentGroup = []
        }
        groupedChildren.push(child)
      }
    })

    // Add any remaining group
    if (currentGroup.length > 0) {
      groupedChildren.push(
        <div key={`inline-group-${groupCounter++}`} className={textPadding ? "px-4" : ""}>
          {currentGroup}
        </div>
      )
    }

    const result = (
      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {groupedChildren}
      </div>
    )

    return result
  }
)

HyperText.displayName = "HyperText"

export default HyperText
