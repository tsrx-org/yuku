function Test(enabled) @{
				let content = null;
				if (enabled) {
					content = <aside /> as JSX.Element;
					renderPreview(<small />);
				}

				@if (content) {
					<main>{content}</main>
				} @else {
					<main />
				}
			}