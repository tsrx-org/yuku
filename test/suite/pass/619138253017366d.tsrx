
				function keywordRef(node: HTMLDivElement) {}
				function jsxRef(node: HTMLDivElement) {}

				const merged = mergeRefs(keywordRef, jsxRef);
				const cleanup = merged(document.createElement('div'));
			