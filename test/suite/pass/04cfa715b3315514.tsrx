
				const objectRef: { current: HTMLDivElement | null } = { current: null };
				const node = document.createElement('div');

				const fromObject = apply_ref_value(objectRef, node);
				const fromCallback = apply_ref_value((element: HTMLDivElement) => {}, node);
				const fromList = apply_ref_value([objectRef], node);
				const fromNull = apply_ref_value(null, node);
			