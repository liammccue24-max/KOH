import { useEffect, useState } from 'react'

/** Returns `value`, but delayed until it stops changing for `delayMs`. Keeps rapid slider drags from triggering a full simulation + geometry rebuild on every tick. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
