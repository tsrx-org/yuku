function App() { return <div>
			@if (show) {
				@for (const item of items.filter((x) => { return x.keep; })) {
					<span>{item.name}</span>
				}
			}
		</div>; }