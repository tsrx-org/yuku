
				type Ref<T> = ((node: T | null) => void) | { current: T | null } | null;

				const callbackRef = (node: HTMLDivElement | null) => {};
				const ref: Ref<HTMLDivElement> = mergeRefs(callbackRef);
			