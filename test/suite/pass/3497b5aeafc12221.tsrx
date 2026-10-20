
				const callbackRef = (node: HTMLDivElement | null) => {};
				const objectRef: { current: HTMLDivElement | null } = { current: null };

				const merged = merge_ref_props(callbackRef, objectRef);
			