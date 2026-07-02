// Thin wrapper over @iconify/react so icon usage stays consistent.
// Oolio uses Unicons (uil: line / uis: solid).
import { Icon as Iconify } from "@iconify/react";
import type { CSSProperties } from "react";

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, color, className, style }: IconProps) {
  return <Iconify icon={name} width={size} height={size} color={color} className={className} style={style} />;
}
