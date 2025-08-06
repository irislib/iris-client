import HomeFeedEvents from "@/pages/home/feed/components/HomeFeedEvents.tsx"
import RightColumn from "@/shared/components/RightColumn.tsx"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Widget from "@/shared/components/ui/Widget.tsx"

function Index() {
  return (
    <section className="flex flex-1 w-full justify-center">
      <div className="flex-1">
        <HomeFeedEvents />
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular">
              <AlgorithmicFeed
                type="popular"
                displayOptions={{
                  small: true,
                  showDisplaySelector: false,
                  randomSort: true,
                }}
              />
            </Widget>
          </>
        )}
      </RightColumn>
    </section>
  )
}

export default Index
