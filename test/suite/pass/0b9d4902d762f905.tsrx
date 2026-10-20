
				const objectRef: { current: HTMLInputElement | null } = { current: null };
				const vueRef: { value: HTMLDivElement | null } = { value: null };
				class Widget {}
				let widget: Widget | null = null;

				const fromObject = create_ref_prop(() => objectRef);
				const fromVue = create_ref_prop(() => vueRef);
				const fromWidget = create_ref_prop(
					() => widget,
					(value) => {
						widget = value;
					},
				);
			