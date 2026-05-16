import * as React from "react"
import { cn } from "@/lib/utils"

type ButtonVariant = "default" | "outline" | "ghost"
type ButtonSize = "default" | "sm" | "lg"

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-[0_18px_48px_rgba(22,101,52,0.22)] hover:bg-primary/90",
  outline:
    "border border-border bg-background/70 text-foreground hover:bg-accent/60",
  ghost: "bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
}

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 px-3 text-xs",
  lg: "h-12 px-6 text-sm",
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    )
  },
)

Button.displayName = "Button"
