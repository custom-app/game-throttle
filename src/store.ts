/** A value that can be watched, which is all the state this library keeps and all it needs */
export interface Store<Value> {
  get(): Value
  set(value: Value): void
  subscribe(listener: (value: Value) => void): () => void
}

/**
 * Kept to twenty lines on purpose: a library that reached for a state library would make every
 * game that installs it carry one, and the games already disagree on which.
 */
export const createStore = <Value>(initial: Value): Store<Value> => {
  const listeners = new Set<(value: Value) => void>()

  let current = initial

  return {
    get: () => current,
    set: (value) => {
      current = value
      listeners.forEach((listener) => listener(value))
    },
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
