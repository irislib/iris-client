export const DEVICE_LABEL_CONTROL_KIND = 10453
export interface PrivateDeviceLabel {
  type: "device-labels"
  v: 2
  owner: string
  device: string
  deviceLabel: string | null
  clientLabel: string | null
  updatedAtSecs: number
}
const pubkey = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
const label = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" &&
    Array.from(value).length <= 128 &&
    !/[\p{Cc}\p{Cs}]/u.test(value))
export function validPrivateDeviceLabel(
  value: unknown,
  owner: string
): value is PrivateDeviceLabel {
  if (!value || typeof value !== "object") return false
  const data = value as Partial<PrivateDeviceLabel>
  return (
    data.type === "device-labels" &&
    data.v === 2 &&
    data.owner === owner &&
    pubkey(data.device) &&
    label(data.deviceLabel) &&
    label(data.clientLabel) &&
    Number.isSafeInteger(data.updatedAtSecs) &&
    data.updatedAtSecs! >= 0 &&
    data.updatedAtSecs! <= Math.floor(Date.now() / 1000) + 300
  )
}
export const portableLabel = (value?: string): string | null =>
  value === undefined
    ? null
    : Array.from(value.replace(/[\p{Cc}\p{Cs}]/gu, "").trim())
        .slice(0, 128)
        .join("") || null
export function compareDeviceLabel(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  const left = new TextEncoder().encode(a),
    right = new TextEncoder().encode(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] - right[i]
  return left.length - right.length
}
