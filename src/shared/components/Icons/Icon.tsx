import {MouseEventHandler} from "react"
import {RiGroupFill} from "@remixicon/react"

import IconsSvg from "./icons.svg"

export interface IconProps {
  name: string
  size?: number
  height?: number
  className?: string
  onClick?: MouseEventHandler<SVGSVGElement>
}

const Icon = (props: IconProps) => {
  const size = props.size || 20
  if (props.name === "groups-solid" || props.name === "groups-outline") {
    return <RiGroupFill size={size} className={props.className} onClick={props.onClick} />
  }
  const href = `${IconsSvg}#` + props.name

  return (
    <svg
      width={size}
      height={props.height ?? size}
      className={props.className}
      onClick={props.onClick}
    >
      <use href={href} />
    </svg>
  )
}

export default Icon
