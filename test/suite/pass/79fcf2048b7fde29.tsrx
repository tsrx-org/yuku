
				let slot: HTMLInputElement | null = null;

				const refProp = create_ref_prop<HTMLInputElement>(
					() => slot,
					(value) => {
						slot = value;
					},
				);
				const cleanup = refProp(document.createElement('input'));
			