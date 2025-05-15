import {getSubscriptionIcon, SubscriptionTier} from "@/shared/utils/subscriptionIcons"
import {useSubscriptionStatus} from "@/shared/hooks/useSubscriptionStatus"
import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import useHistoryState from "@/shared/hooks/useHistoryState"
import {RiCheckboxCircleFill} from "@remixicon/react"
import {useUserStore} from "@/stores/user"
import IrisAPI, {Invoice} from "@/utils/IrisAPI"
import {useEffect, useState} from "react"

type Duration = 3 | 12
export type PlanId = 1 | 2 | 3

const planToTier = (plan: PlanId): SubscriptionTier => {
  switch (plan) {
    case 1:
      return "patron"
    case 2:
      return "champion"
    case 3:
      return "vanguard"
  }
}

interface Plan {
  id: PlanId
  name: string
  colour: "error" | "warning" | "primary"
  price: Record<Duration, {amount: number; pricingOptionId: number}>
  benefits: string[]
}

const plans: Plan[] = [
  {
    id: 1,
    name: "Patron",
    colour: "error",
    price: {
      3: {amount: 15, pricingOptionId: 3},
      12: {amount: 50, pricingOptionId: 4},
    },
    benefits: [
      "Support Iris development",
      "Patron badge on profile",
      "Yearly subscriber badge",
      "6–7 character username",
    ],
  },
  {
    id: 2,
    name: "Champion",
    colour: "warning",
    price: {
      3: {amount: 60, pricingOptionId: 2},
      12: {amount: 200, pricingOptionId: 1},
    },
    benefits: [
      "All Patron benefits",
      "Champion badge on profile",
      "Priority support",
      "5–6 character username",
    ],
  },
  {
    id: 3,
    name: "Vanguard",
    colour: "primary",
    price: {
      3: {amount: 300, pricingOptionId: 5},
      12: {amount: 1000, pricingOptionId: 6},
    },
    benefits: [
      "All Champion benefits",
      "Vanguard badge on profile",
      "VIP support",
      "Honorary mention on About page",
      "3–4 character username",
    ],
  },
]

export default function Subscription() {
  const pubkey = useUserStore((state) => state.publicKey)
  const {isSubscriber, endDate} = useSubscriptionStatus(pubkey)

  const [duration, setDuration] = useHistoryState<Duration>(3, "subscriptionDuration")
  const [plan, setPlan] = useHistoryState<PlanId>(1, "subscriptionPlan")

  const totalPrice = (p: PlanId) =>
    plans.find((x) => x.id === p)!.price[duration as Duration].amount
  const monthly = (p: PlanId) => (totalPrice(p) / duration).toFixed(2)

  const [invoices, setInvoices] = useState<Invoice[]>([])

  const handleSubscribe = async () => {
    try {
      const irisAPI = new IrisAPI()
      const response = await irisAPI.createSubscription({
        subscription_plan: plan,
        pricing_option: plans.find((x) => x.id === plan)!.price[duration as Duration]
          .pricingOptionId,
        currency: "USD",
      })

      console.log("Subscription created:", response)
      // Fetch invoices after creating the subscription
      fetchInvoices()
    } catch (error) {
      console.error("Error creating subscription:", error)
    }
  }

  const fetchInvoices = async () => {
    try {
      const irisAPI = new IrisAPI()
      const response = await irisAPI.getInvoices()
      setInvoices(response)
    } catch (error) {
      console.error("Error fetching invoices:", error)
    }
  }

  useEffect(() => {
    if (pubkey) {
      fetchInvoices()
    }
  }, [pubkey, plan])

  return (
    <div className="flex flex-col gap-6 p-4">
      {pubkey && isSubscriber && (
        <div className="flex flex-col items-center gap-2">
          <SubscriberBadge pubkey={pubkey} />
          <span>
            Your subscription is active until{" "}
            {endDate && new Date(endDate).toLocaleDateString()}
          </span>
        </div>
      )}

      <div className="flex justify-center gap-2">
        {[3, 12].map((m) => (
          <button
            key={m}
            className={`btn btn-sm ${duration === m ? "btn-accent" : "btn-outline"}`}
            onClick={() => setDuration(m as Duration)}
          >
            {m === 3 ? "3 months" : "12 months (save 16.66%)"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((p) => {
          const active = p.id === plan
          return (
            <article
              key={p.id}
              role="button"
              onClick={() => setPlan(p.id)}
              className={`card bg-base-200 shadow-xl cursor-pointer transition-transform hover:scale-[1.02] border-2 ${
                active ? `border-${p.colour}` : "border-transparent"
              }`}
            >
              <div className="card-body flex flex-col h-full">
                <header className="flex justify-between items-start">
                  <h3 className="card-title text-xl">{p.name}</h3>
                  {getSubscriptionIcon(planToTier(p.id), `text-${p.colour} text-2xl`)}
                </header>

                <ul className="space-y-2 my-4 text-sm">
                  {p.benefits.map((b) => (
                    <li key={b} className="flex items-center gap-2">
                      <RiCheckboxCircleFill className="h-4 w-4 text-success flex-shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <footer className="mt-auto">
                  <div className="text-lg font-semibold">${monthly(p.id)}/month</div>
                  <div className="text-sm text-base-content/60">
                    ${totalPrice(p.id)} every {duration} months
                  </div>
                </footer>
              </div>
            </article>
          )
        })}
      </div>

      <a href="#" onClick={handleSubscribe} className="btn btn-accent self-center">
        Subscribe – ${totalPrice(plan)}
      </a>

      {invoices.length > 0 && (
        <div className="mt-4">
          <h4 className="text-lg font-semibold">Invoices</h4>
          <ul className="space-y-2">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex justify-between items-center">
                <div>
                  <div className="font-medium">
                    {new Date(invoice.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-base-content/60">
                    Status: {invoice.status}
                  </div>
                </div>
                <div className="text-right font-medium">
                  ${(invoice.amount / 100).toFixed(2)} USD
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-base-content/50 text-center mt-4">
        More features upcoming
      </div>
    </div>
  )
}
