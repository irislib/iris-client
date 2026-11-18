import {
  forwardRef,
  MouseEvent as ReactMouseEvent,
  CSSProperties,
  ReactNode,
  AnchorHTMLAttributes,
} from "react"
import {useNavigate, useNavigation} from "./hooks"
import {withRecoveryMount} from "./recoveryMount"

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
  replace?: boolean
  state?: unknown
  preventScrollReset?: boolean
  relative?: "route" | "path"
  reloadDocument?: boolean
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({to, replace, state, children, onClick, ...rest}, ref) => {
    const navigate = useNavigate()

    const handleClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
      // Allow default behavior for:
      // - Links with target="_blank"
      // - Modified clicks (ctrl/cmd/shift)
      // - Right clicks
      if (
        rest.target === "_blank" ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey
      ) {
        return
      }

      e.preventDefault()

      if (onClick) {
        onClick(e)
      }

      navigate(to, {replace, state})
    }

    return (
      <a ref={ref} href={withRecoveryMount(to)} onClick={handleClick} {...rest}>
        {children}
      </a>
    )
  }
)

Link.displayName = "Link"

// NavLink component with active state
interface NavLinkProps extends Omit<LinkProps, "className" | "style" | "children"> {
  className?: string | ((props: {isActive: boolean}) => string)
  style?: CSSProperties | ((props: {isActive: boolean}) => CSSProperties)
  children?: ReactNode | ((props: {isActive: boolean}) => ReactNode)
  end?: boolean
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({className, style, to, end, children, ...rest}, ref) => {
    const {currentPath} = useNavigation()

    let isActive: boolean
    if (end) {
      isActive = currentPath === to
    } else if (to === "/") {
      isActive = currentPath === "/"
    } else {
      isActive = currentPath === to || currentPath.startsWith(to + "/")
    }

    const computedClassName =
      typeof className === "function" ? className({isActive}) : className

    const computedStyle = typeof style === "function" ? style({isActive}) : style

    const computedChildren =
      typeof children === "function" ? children({isActive}) : children

    return (
      <Link
        ref={ref}
        to={to}
        className={computedClassName}
        style={computedStyle}
        {...rest}
      >
        {computedChildren}
      </Link>
    )
  }
)

NavLink.displayName = "NavLink"
