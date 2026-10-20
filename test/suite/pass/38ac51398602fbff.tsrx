function App() { return <ul>
			@for (const item of items; key item.id) {
				<li>{item.label}</li>
			}
		</ul>; }