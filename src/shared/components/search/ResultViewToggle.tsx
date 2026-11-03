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
      className="link min-w-28 py-1 text-left text-sm text-info"
      aria-busy={busy}
      onClick={() => onChange(!aiSelected)}
    >
      {aiSelected ? "Show all" : "Show AI selected"}
    </button>
  )
}
