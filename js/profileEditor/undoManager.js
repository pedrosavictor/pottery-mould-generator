/**
 * undoManager.js -- Undo/redo state management for the profile editor.
 *
 * Maintains a history stack of profile data snapshots. Each snapshot is a
 * deep clone of the profile points array, stored as plain JSON-serializable
 * objects.
 *
 * USAGE:
 * ------
 * const undo = createUndoManager();
 * undo.push(profilePoints);       // Save snapshot after each edit
 * const prev = undo.undo();       // Go back (returns profile points or null)
 * const next = undo.redo();       // Go forward (returns profile points or null)
 *
 * STACK MODEL:
 * ------------
 *   [state0, state1, state2, state3]
 *                              ^
 *                            cursor
 *
 *   undo() -> cursor moves left, returns state2
 *   redo() -> cursor moves right, returns state3
 *   push() -> discards everything after cursor, appends new state
 *
 * The history is capped at maxHistory entries. When the cap is reached,
 * the oldest entry is dropped (shift from the front).
 */

/**
 * Create an undo/redo manager.
 *
 * @param {number} [maxHistory=100] - Maximum number of history entries.
 * @returns {{ push: function, undo: function, redo: function, canUndo: function, canRedo: function, clear: function }}
 */
export function createUndoManager(maxHistory = 100) {
  /** @type {Array<string>} History stack of JSON-stringified snapshots. */
  let history = [];

  /** Current position in the history stack. -1 means empty. */
  let cursor = -1;

  /**
   * Deep clone profile points via JSON serialization.
   * This is safe because profile data is plain objects with no methods,
   * Date objects, or circular references.
   *
   * @param {Array} data - Profile points array.
   * @returns {string} JSON string snapshot.
   */
  function serialize(data) {
    return JSON.stringify(data);
  }

  /**
   * Restore profile points from a JSON snapshot.
   *
   * @param {string} snapshot - JSON string.
   * @returns {Array} Profile points array.
   */
  function deserialize(snapshot) {
    return JSON.parse(snapshot);
  }

  return {
    /**
     * Push a new state onto the history stack.
     * Discards any redo states after the current cursor position.
     * Enforces the maxHistory cap by dropping the oldest entry.
     *
     * @param {Array} profilePoints - Current profile points to save.
     */
    push(profilePoints) {
      // Discard redo states (everything after cursor)
      history = history.slice(0, cursor + 1);

      // Add new snapshot
      history.push(serialize(profilePoints));
      cursor = history.length - 1;

      // Enforce cap
      if (history.length > maxHistory) {
        history.shift();
        cursor--;
      }
    },

    /**
     * Undo: move cursor back one step and return the previous state.
     *
     * @returns {Array|null} Profile points array, or null if nothing to undo.
     */
    undo() {
      if (cursor <= 0) return null;
      cursor--;
      return deserialize(history[cursor]);
    },

    /**
     * Redo: move cursor forward one step and return the next state.
     *
     * @returns {Array|null} Profile points array, or null if nothing to redo.
     */
    redo() {
      if (cursor >= history.length - 1) return null;
      cursor++;
      return deserialize(history[cursor]);
    },

    /**
     * Whether there is a state to undo to.
     * @returns {boolean}
     */
    canUndo() {
      return cursor > 0;
    },

    /**
     * Whether there is a state to redo to.
     * @returns {boolean}
     */
    canRedo() {
      return cursor < history.length - 1;
    },

    /**
     * Clear all history. Resets to empty state.
     */
    clear() {
      history = [];
      cursor = -1;
    },
  };
}
