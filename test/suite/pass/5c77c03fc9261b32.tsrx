function Test(enabled, ready, items, value) @{
					if (enabled) {
						<div />;
						<><div /></>;
						<style>div { color: red; }</style>;
						@if (ready) { <div /> } @else { <span /> };
						@for (const item of items) { <div>{item}</div> };
						@switch (value) { @case 1: { <div /> } @default: { <span /> } };
						@try { <div /> } @catch (error) { <span /> };
						@{ <div /> };
					}

					<main />
				}