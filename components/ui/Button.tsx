import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import s from "./Button.module.css";

type Variant = "default" | "primary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  icon?: IconName;
}

export function Button({ variant = "default", small, icon, className, children, type = "button", ...rest }: Props) {
  const cls = [s.button, variant !== "default" && s[variant], small && s.small, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

// Icon-only buttons always carry a label for screen readers and a matching tooltip.
export function IconButton({ icon, label, className, ...rest }: Omit<Props, "children"> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={[s.button, s.icon, className].filter(Boolean).join(" ")} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
