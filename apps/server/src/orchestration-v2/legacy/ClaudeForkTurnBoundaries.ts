interface LegacyClaudeTurn {
  readonly turnId: string;
  readonly pendingMessageId: string | null;
  readonly driver: string | null | undefined;
  readonly providerInstanceId: string | null | undefined;
}

/** V1 forks rewrote native UUIDs while retaining the ordered, checkpointed app turns. */
export function remapLegacyClaudeForkTurnBoundaries(input: {
  readonly hasReverted: boolean;
  readonly providerInstanceId: string;
  readonly turns: ReadonlyArray<LegacyClaudeTurn>;
  readonly nativeBoundaries: ReadonlyArray<string | null> | undefined;
}): ReadonlyMap<string, string> | undefined {
  const boundaries = input.nativeBoundaries;
  if (
    !input.hasReverted ||
    boundaries === undefined ||
    input.turns.length === 0 ||
    input.turns.length !== boundaries.length ||
    input.turns.some(
      (turn) =>
        // Synthetic background turns record assistant boundaries, not user input.
        turn.pendingMessageId === null ||
        turn.driver !== "claudeAgent" ||
        turn.providerInstanceId !== input.providerInstanceId,
    ) ||
    boundaries.some((id) => id === null || id.length === 0) ||
    new Set(boundaries).size !== boundaries.length ||
    new Set(input.turns.map((turn) => turn.turnId)).size !== input.turns.length
  )
    return undefined;
  const boundaryIndices = new Map(boundaries.map((id, index) => [id, index]));
  const remapped = new Map<string, string>();
  for (const [index, turn] of input.turns.entries()) {
    // Turns submitted after the old fork keep their UUIDs; they must agree
    // with the positional mapping before we trust the rewritten prefix.
    const exactIndex = boundaryIndices.get(turn.turnId);
    if (exactIndex !== undefined && exactIndex !== index) return undefined;
    const boundary = boundaries[index];
    if (boundary == null) return undefined;
    remapped.set(turn.turnId, boundary);
  }
  return remapped;
}
