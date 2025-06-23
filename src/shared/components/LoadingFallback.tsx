import runningOstrich from "@/assets/running-ostrich.gif"
import {Suspense} from "react"

export const LoadingFallback = () => (
  <div className="flex items-center justify-center w-full h-full p-8">
    <Suspense fallback={<div>Loading...</div>}>
      <img src={runningOstrich} alt="Loading..." className="w-24" />
    </Suspense>
  </div>
)
