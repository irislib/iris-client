import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  attachTranslation,
  displayText,
  paragraphs,
  supported,
  type Paragraphs,
  type Translations,
} from "@/lib/translation"
import HyperText from "./HyperText"

export function Translation({
  groups,
  children,
  action,
}: {
  groups: Paragraphs
  children: (result?: Translations) => ReactNode
  action?: string
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [shown, setShown] = useState<{groups: Paragraphs; result?: Translations}>()
  useEffect(() => {
    if (button.current)
      return attachTranslation(
        button.current,
        groups,
        (result) => setShown({groups, result}),
        action
      )
  }, [groups, action])
  if (!supported || !groups.length) return children()
  return (
    <div data-translation-item="">
      {children(shown?.groups === groups ? shown.result : undefined)}
      <button
        type="button"
        ref={button}
        className="invisible block w-32 max-w-full truncate text-start text-xs leading-5 opacity-70 hover:underline"
      >
        {action || "Translate"}
      </button>
    </div>
  )
}

export function TranslatableText({children, ...props}: ComponentProps<typeof HyperText>) {
  const groups = useMemo(() => paragraphs(children), [children])
  return (
    <Translation groups={groups}>
      {(result) => <HyperText {...props}>{displayText(children, result)}</HyperText>}
    </Translation>
  )
}
