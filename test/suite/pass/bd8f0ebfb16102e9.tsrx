function App() { return <ul>
			@for (const item of items; key item.id) {
				<li>{item.label}</li>
			} @empty {
				const message = 'No items';
				<li>{message}</li>
			}
		</ul>; }