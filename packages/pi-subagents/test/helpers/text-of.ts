/** The text of a tool result's first content item, failing loudly when it is not text. */
export function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
	const first = result.content[0] as { type: string; text?: string } | undefined;
	if (first?.type !== "text" || first.text === undefined) {
		throw new Error(`expected a text content item, got ${first?.type ?? "none"}`);
	}
	return first.text;
}
