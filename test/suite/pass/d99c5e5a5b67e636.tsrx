function App({ mode, items }) @{
	const label = @switch (mode) { @case 'a': { <b>a</b> } @default: { <i>b</i> } };
	<div>
		@switch (mode) {
			@case 'list': {
				const first = items[0];
				<ul>
					@for (const item of items) {
						<li>{item}</li>
					}
				</ul>
			}
			@case 'one': {
				@if (items[0]) { <p>{items[0]}</p> }
			}
			@default: {
				doThing();
				<>{label} none</>
			}
		}
	</div>
}