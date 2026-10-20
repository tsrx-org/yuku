
				const callbackRef = (node: HTMLDivElement | null) => {};
				const ref: RefValueSlot = merge_ref_props(callbackRef);

				type RefValueSlot = ReturnType<typeof merge_ref_props<HTMLDivElement>>;
			