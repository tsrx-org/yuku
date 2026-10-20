
				let slot: HTMLDivElement | null = null;

				create_ref_prop(
					() => slot,
					(value: HTMLDivElement) => {
						slot = value;
					},
				);
			