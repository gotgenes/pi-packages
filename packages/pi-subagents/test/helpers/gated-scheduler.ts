/**
 * A scheduler that holds every thunk until the test opens the slot — a stand-in
 * for the concurrency limiter when a test needs a run to wait in the queue.
 */
export function gatedScheduler(): {
	schedule: (thunk: () => Promise<void>) => Promise<void>;
	openSlot: () => void;
} {
	const { promise: gate, resolve: openSlot } = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
	return {
		schedule: async (thunk) => {
			await gate;
			await thunk();
		},
		openSlot: () => {
			openSlot();
		},
	};
}
