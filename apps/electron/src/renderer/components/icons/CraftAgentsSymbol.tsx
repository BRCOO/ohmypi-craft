interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Oh My Pi symbol - compact pi mark used in menus and onboarding
 * Uses accent color from theme (currentColor from className)
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="17.5" cy="16.5" r="4.5" fill="currentColor" opacity="0.85" />
      <circle cx="47" cy="47" r="4.5" fill="currentColor" opacity="0.85" />
      <path d="M21 17.5C27.2 13.2 38.1 13.4 43 20.1C48.2 27.3 45.7 39.1 39.1 45.4C32.9 51.4 23.1 52.5 17.1 46.9C11.6 41.7 12.2 32.5 18.4 28.6C23.6 25.3 31.5 27 34.8 33" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <text x="32" y="40" textAnchor="middle" fontFamily="Inter, Segoe UI Symbol, Arial, sans-serif" fontSize="31" fontWeight="700" fill="currentColor">π</text>
    </svg>
  )
}
