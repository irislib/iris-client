import Widget from "@/shared/components/ui/Widget"
import AlgorithmicFeed from "./AlgorithmicFeed"

export default function PopularWidget({className = "h-96"}: {className?: string}) {
  return (
    <Widget title="Popular" className={className}>
      <AlgorithmicFeed
        type="popular"
        displayOptions={{small: true, showDisplaySelector: false}}
      />
    </Widget>
  )
}
