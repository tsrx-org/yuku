
				const objectRef: { current: HTMLDivElement | null } = { current: null };
				const vueRef: { value: HTMLDivElement | null } = { value: null };
				const callbackRef = (node: HTMLDivElement | null) => {};

				const fromObject = mergeRefs(objectRef);
				const fromVue = mergeRefs(vueRef);
				const fromMix = mergeRefs(callbackRef, objectRef, vueRef);
			