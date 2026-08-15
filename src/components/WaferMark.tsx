/**
 * A wafer disc with a flat edge -- the real notch/flat every (100) wafer
 * carries to mark its <110> crystal direction, which is exactly the
 * reference direction this whole simulator depends on for mask alignment.
 */
export function WaferMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 3.2a12.8 12.8 0 0 1 12.8 12.8 12.8 12.8 0 0 1-4.94 10.104L18.2 16.2V3.25A12.9 12.9 0 0 1 16 3.2Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M16 3.2a12.8 12.8 0 1 0 8.8 22.104"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M24.8 25.304 18.2 16.2V3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="2.1" fill="currentColor" />
    </svg>
  )
}
