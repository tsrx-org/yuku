
				let slot: HTMLDivElement | null = null;

				const refProp = create_ref_prop(
					() => slot,
					(value) => {
						slot = value;
					},
				);
				const cleanup = refProp(document.createElement('div'));
			