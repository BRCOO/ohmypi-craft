import ohMyPiLogo from "@/assets/ohmypi_logo.svg"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * CraftAppIcon - Displays the Oh My Pi app logo.
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={ohMyPiLogo}
      alt="Oh My Pi"
      width={size}
      height={size}
      className={className}
    />
  )
}
