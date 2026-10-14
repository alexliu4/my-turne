import type { IconProps } from "../../../types";

export const ComputerIcon = ({ className }: IconProps) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 4h18v13H3zM8 21h8M12 17v4"
    />
  </svg>
);
