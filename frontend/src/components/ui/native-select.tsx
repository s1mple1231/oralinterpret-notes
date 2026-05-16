import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  shellClassName?: string
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, shellClassName, children, ...props }, ref) => {
    return (
      <div
        className={cn(
          "relative flex h-12 items-center rounded-2xl border border-border/80 bg-background/80 shadow-sm",
          shellClassName,
        )}
      >
        <select
          ref={ref}
          className={cn(
            "h-full w-full appearance-none rounded-2xl bg-transparent px-4 pr-10 text-sm text-foreground outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
      </div>
    )
  },
)

NativeSelect.displayName = "NativeSelect"
