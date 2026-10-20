function App() { return <ul>
				@for (const item of items) {
					<li>{item}</li>
				} empty {
					<li>Empty</li>
				}
			</ul>; }