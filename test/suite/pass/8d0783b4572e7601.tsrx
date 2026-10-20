function App() { return <div>
			@if (show) {
				@for (const item of items) {
					<span>{item}</span>
				} @empty {
					@if (fallback) {
						<b>none</b>
					}
				}
			}
		</div>; }