interface ResultViewToggleProps {
  aiSelected: boolean
  onChange: (aiSelected: boolean) => void
  busy?: boolean
}

export default function ResultViewToggle({
  aiSelected,
  onChange,
  busy,
}: ResultViewToggleProps) {
  return (
    <button
      type="button"
      className="link inline-grid min-w-28 shrink-0 py-1 text-left text-sm text-info"
      aria-busy={busy}
      onClick={() => onChange(!aiSelected)}
    >
      {/* Keep both labels in the same grid cell so either state reserves the
          wider label's actual width, including when the browser font changes. */}
      <span className={`col-start-1 row-start-1 ${aiSelected ? "" : "invisible"}`}>
        Show all
      </span>
      <span className={`col-start-1 row-start-1 ${aiSelected ? "invisible" : ""}`}>
        Show AI selected
      </span>
    </button>
  )
}
