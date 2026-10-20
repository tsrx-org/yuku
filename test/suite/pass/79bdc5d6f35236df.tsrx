
				let input: HTMLInputElement | null = null;
				let progress: HTMLProgressElement | null = null;
				let either: HTMLInputElement | HTMLTextAreaElement | null = null;

				const inputRef = create_ref_prop(
					() => input,
					(value) => {
						input = value;
					},
				);
				const progressRef = create_ref_prop(
					() => progress,
					(value) => {
						progress = value;
					},
				);
				const eitherRef = create_ref_prop(
					() => either,
					(value) => {
						either = value;
					},
				);
			