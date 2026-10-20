
				class Widget {}
				const callbackRef = (node: Widget | null) => {};

				const merged = mergeRefs(callbackRef);
				const cleanup = merged(new Widget());
			