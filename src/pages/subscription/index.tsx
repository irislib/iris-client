import {
  useSubscriptionStatus,
  invalidateSubscriptionCache,
} from "@/shared/hooks/useSubscriptionStatus"
import {getSubscriptionIcon, SubscriptionTier} from "@/shared/utils/subscriptionIcons"
import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import useHistoryState from "@/shared/hooks/useHistoryState"
import Header from "@/shared/components/header/Header"
import {RiCheckboxCircleFill} from "@remixicon/react"
import Modal from "@/shared/components/ui/Modal"
import IrisAPI, {Invoice} from "@/utils/IrisAPI"
import {useUserStore} from "@/stores/user"
import {useEffect, useState} from "react"
import {Helmet} from "react-helmet"

type Duration = 3 | 12
export type PlanId = 1 | 2 | 3

const getPlanNumberFromTier = (tier: SubscriptionTier): PlanId => {
  switch (tier) {
    case "vanguard":
      return 3
    case "champion":
      return 2
    case "patron":
      return 1
  }
}

const planToTier = (plan: PlanId): SubscriptionTier => {
  switch (plan) {
    case 3:
      return "vanguard"
    case 2:
      return "champion"
    case 1:
      return "patron"
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
      3: {amount: 15, pricingOptionId: 2},
      12: {amount: 50, pricingOptionId: 1},
    },
    benefits: [
      "vault.iris.to relay write access",
      "10 GB upload storage (blossom)",
      "6+ character username",
      "Patron badge on profile",
      "Support Iris development",
    ],
  },
  {
    id: 2,
    name: "Champion",
    colour: "warning",
    price: {
      3: {amount: 60, pricingOptionId: 3},
      12: {amount: 200, pricingOptionId: 4},
    },
    benefits: [
      "All Patron benefits",
      "100 GB upload storage (blossom)",
      "5+ character username",
      "Priority support",
      "Champion badge on profile",
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
      "3+ character username",
      "VIP support",
      "Vanguard badge on profile",
      "Honorary mention on About page",
    ],
  },
]

export default function SubscriptionPage() {
  const pubkey = useUserStore((state) => state.publicKey)
  const {
    isSubscriber,
    endDate,
    tier: currentTier,
    refresh,
  } = useSubscriptionStatus(pubkey)

  const [duration, setDuration] = useHistoryState<Duration>(3, "subscriptionDuration")
  const [plan, setPlan] = useHistoryState<PlanId>(1, "subscriptionPlan")
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null)

  const totalPrice = (p: PlanId) =>
    plans.find((x) => x.id === p)!.price[duration as Duration].amount
  const monthly = (p: PlanId) => (totalPrice(p) / duration).toFixed(2)

  const [invoices, setInvoices] = useState<Invoice[]>([])

  // Set initial plan based on current subscription
  useEffect(() => {
    if (!isSubscriber) {
      setPlan(1) // Select Patron for new subscribers
      return
    }

    const currentPlanNumber = getPlanNumberFromTier(currentTier ?? "patron")
    const nextPlan = (currentPlanNumber + 1) as PlanId
    setPlan(nextPlan <= 3 ? nextPlan : currentPlanNumber)
  }, [currentTier, setPlan, isSubscriber])

  // Helper to determine if a plan is selectable
  const isPlanSelectable = (planId: PlanId) => {
    if (!isSubscriber) return true
    const currentPlanNumber = getPlanNumberFromTier(currentTier ?? "patron")
    return planId >= currentPlanNumber
  }

  // Helper to determine if subscribe button should be enabled
  const isSubscribeEnabled = () => {
    if (!isSubscriber) return true
    const currentPlanNumber = getPlanNumberFromTier(currentTier ?? "patron")
    return plan >= currentPlanNumber
  }

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

      // Show payment modal if we have a BTCPayServer URL
      if (response.invoice?.btcpayserver_invoice_url) {
        setPaymentUrl(response.invoice.btcpayserver_invoice_url)
        setShowPaymentModal(true)
      }

      // Fetch invoices after creating the subscription
      fetchInvoices(true)
    } catch (error) {
      console.error("Error creating subscription:", error)
    }
  }

  const fetchInvoices = async (shouldGetPaymentUrl = false) => {
    try {
      const irisAPI = new IrisAPI()
      const response = await irisAPI.getInvoices()
      setInvoices(response)

      // Only get payment URL if we just subscribed
      if (shouldGetPaymentUrl) {
        const pendingInvoices = response
          .filter((invoice) => invoice.status === "pending")
          .sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        if (pendingInvoices.length > 0) {
          const latestPendingInvoice = pendingInvoices[0]
          const data = await irisAPI.getPaymentLink(latestPendingInvoice.id)
          if (data.btcpayserver_invoice_url) {
            setPaymentUrl(data.btcpayserver_invoice_url)
            setShowPaymentModal(true)
          }
        }
      }
    } catch (error) {
      console.error("Error fetching invoices:", error)
    }
  }

  const handleGetPaymentLink = async (invoiceId: string) => {
    try {
      const irisAPI = new IrisAPI()
      const data = await irisAPI.getPaymentLink(invoiceId)
      if (data.btcpayserver_invoice_url) {
        setPaymentUrl(data.btcpayserver_invoice_url)
        setShowPaymentModal(true)
      }
    } catch (error) {
      console.error("Error getting payment link:", error)
    }
  }

  const handleModalClose = () => {
    setShowPaymentModal(false)
    if (pubkey) {
      invalidateSubscriptionCache(pubkey)
    }
    fetchInvoices(false)
    refresh()
  }

  useEffect(() => {
    if (pubkey) {
      fetchInvoices(false)
    }
  }, [pubkey, plan])

  const getButtonText = () => {
    if (!isSubscriber) return "Subscribe"
    return plan === getPlanNumberFromTier(currentTier ?? "patron") ? "Extend" : "Upgrade"
  }

  return (
    <div className="flex flex-col flex-1">
      <Header title="Subscription" slideUp={false} />
      <div className="p-4 mx-4 md:p-8 rounded-lg bg-base-100 shadow">
        <div className="flex flex-col gap-6 p-4">
          {pubkey && isSubscriber && (
            <div className="flex flex-col items-center gap-2">
              <SubscriberBadge pubkey={pubkey} />
              <span>
                Active until <b>{endDate && new Date(endDate).toLocaleDateString()}</b>
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
              const isCurrentPlan = currentTier === planToTier(p.id)
              const selectable = isPlanSelectable(p.id)
              return (
                <article
                  key={p.id}
                  role="button"
                  onClick={() => selectable && setPlan(p.id)}
                  className={`card bg-base-200 shadow-xl cursor-pointer transition-transform hover:scale-[1.02] border-2 
                    ${p.id === plan ? `border-${p.colour}` : "border-transparent"}`}
                >
                  <div className="card-body flex flex-col h-full">
                    <header className="flex justify-between items-start">
                      <h3 className="card-title text-xl">
                        {p.name}
                        {isCurrentPlan && (
                          <span className="text-sm text-accent">(Current)</span>
                        )}
                      </h3>
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

          <a
            href="#"
            onClick={handleSubscribe}
            className={`btn self-center ${isSubscribeEnabled() ? "btn-accent" : "btn-disabled"}`}
          >
            {getButtonText()} – ${totalPrice(plan)}
          </a>

          {invoices.length > 0 && (
            <div className="mt-4">
              <h4 className="text-lg font-semibold">Invoices</h4>
              <ul className="space-y-2">
                {invoices
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                  )
                  .map((invoice) => (
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
                        ${invoice.amount.toFixed(2)} USD
                        {invoice.status === "pending" && (
                          <button
                            onClick={() => handleGetPaymentLink(invoice.id)}
                            className="btn btn-sm btn-primary ml-2"
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {showPaymentModal && paymentUrl && (
            <Modal hasBackground={false} onClose={handleModalClose}>
              <iframe
                src={paymentUrl}
                className="w-[600px] h-[800px] max-h-[90vh] max-w-[95vw] rounded-lg"
                title="BTCPayServer Payment"
              />
            </Modal>
          )}
        </div>
      </div>
      <Helmet>
        <title>Subscription</title>
      </Helmet>
    </div>
  )
}
