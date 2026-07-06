interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Oh My Pi symbol - compact pi mark used in menus and onboarding.
 * Uses accent color from theme (currentColor from className).
 *
 * The pi mark is a path instead of a font glyph so it renders consistently
 * across Windows, macOS, Linux, and bundled SVG/ICO generation.
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
      <path
        d="M21 17.5C27.2 13.2 38.1 13.4 43 20.1C48.2 27.3 45.7 39.1 39.1 45.4C32.9 51.4 23.1 52.5 17.1 46.9C11.6 41.7 12.2 32.5 18.4 28.6C23.6 25.3 31.5 27 34.8 33"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M15.5 19h33a4 4 0 0 1 0 8h-6.25v20a4 4 0 0 1-8 0V27h-7v20a4 4 0 0 1-8 0V27H15.5a4 4 0 0 1 0-8z"
        fill="currentColor"
      />
    </svg>
  )
}
