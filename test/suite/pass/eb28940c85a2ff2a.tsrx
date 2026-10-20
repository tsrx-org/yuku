function App({ value }) @{
	const label = 'outer';
	@switch (value) {
		@case label: {
			const label = 'inner';
			<p>{label}</p>
		}
	}
}