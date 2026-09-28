import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary hover:bg-[#c99662]",
        outline:
          "bg-transparent text-foreground border border-input hover:bg-secondary",
        ghost: "bg-transparent text-foreground hover:bg-secondary",
        allOff:
          "bg-transparent text-destructive border border-destructive hover:bg-[#1a1113] font-semibold",
      },
      size: {
        default: "h-10 px-4",
        lg: "h-12 px-5 text-[15px]",
        thumb: "h-12 w-full text-[15px]",
        sidebar: "h-11 w-full",
        bar: "h-[34px] px-3.5 text-[13px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
