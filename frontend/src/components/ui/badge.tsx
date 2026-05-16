import * as React from "react"
import { cn } from "@/lib/utils"

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/80 bg-secondary/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-secondary-foreground",
        className,
      )}
      {...props}
    />
  )
}
