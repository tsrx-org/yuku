function App() { return <ul>
				@for (const item of items) {
					<li>{item.label}</li>
				} @empty <li>No items</li>
			</ul>; }