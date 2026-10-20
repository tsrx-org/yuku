function App() { return <div>
			@if (a) {
				@for (const item of items) {
					@if (item.ok) {
						<span>{item.name}</span>
					} @else {
						<span>skip</span>
					}
				}
			} @else {
				<span>empty</span>
			}
		</div>; }