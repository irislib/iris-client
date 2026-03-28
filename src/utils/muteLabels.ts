export const getMuteLabel = (capitalized = true): string => {
  const label = "mute"
  return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

export const getMutedLabel = (capitalized = true): string => {
  const label = "muted"
  return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

export const getUnmuteLabel = (capitalized = true): string => {
  const label = "unmute"
  return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label
}
