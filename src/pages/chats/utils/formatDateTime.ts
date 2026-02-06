type DateTimeFormatOverrides = {
  locale?: string
  timeZone?: string
}

const buildBaseOptions = (overrides?: DateTimeFormatOverrides): Intl.DateTimeFormatOptions => {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }

  if (overrides?.timeZone) {
    options.timeZone = overrides.timeZone
  }

  return options
}

export const formatDateTimeSeconds = (
  timestampMs: number,
  overrides?: DateTimeFormatOverrides
): string => {
  return new Date(timestampMs).toLocaleString(
    overrides?.locale ?? "en-US",
    buildBaseOptions(overrides)
  )
}

export const formatDateTimeMilliseconds = (
  timestampMs: number,
  overrides?: DateTimeFormatOverrides
): string => {
  const options: Intl.DateTimeFormatOptions = {
    ...buildBaseOptions(overrides),
    fractionalSecondDigits: 3,
  }
  return new Date(timestampMs).toLocaleString(overrides?.locale ?? "en-US", options)
}

