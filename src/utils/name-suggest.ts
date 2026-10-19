/**
 * Optimal-string-alignment (Damerau) distance: like Levenshtein, but swapping two adjacent letters
 * — the commonest typo (`Emial`) — costs one edit, not two.
 */
function editDistance(a: string, b: string): number {
	const rows = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(
				rows[i - 1]![j]! + 1,
				rows[i]![j - 1]! + 1,
				rows[i - 1]![j - 1]! + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				best = Math.min(best, rows[i - 2]![j - 2]! + 1);
			}
			rows[i]![j] = best;
		}
	}
	return rows[a.length]![b.length]!;
}

/**
 * Longest name worth suggesting for. Real Creatio identifiers are far shorter; the cap stops a
 * client-supplied name from turning the O(n·m) distance into an event-loop stall.
 */
const MAX_SUGGEST_LENGTH = 128;

/**
 * The known names closest to a mistyped one, best first: a case-only difference, then typos within
 * roughly a third of the name's length. Nothing is suggested when no name is close.
 */
export function suggestNames(target: string, candidates: Iterable<string>, limit = 3): string[] {
	if (target.length > MAX_SUGGEST_LENGTH) {
		return [];
	}
	const wanted = target.toLowerCase();
	const scored: Array<{ name: string; score: number }> = [];
	for (const name of new Set(candidates)) {
		const known = name.toLowerCase();
		const tolerance = Math.max(1, Math.floor(Math.max(wanted.length, known.length) / 3));
		// The distance is at least the length gap, so a wider gap can never be within tolerance.
		if (Math.abs(wanted.length - known.length) > tolerance) {
			continue;
		}
		const score = editDistance(wanted, known);
		if (score <= tolerance) {
			scored.push({ name, score });
		}
	}
	return scored
		.sort(
			(a, b) =>
				a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
		)
		.slice(0, limit)
		.map((entry) => entry.name);
}
