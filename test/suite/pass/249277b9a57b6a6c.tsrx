function App() { return <div>@{
			function getBuilder() {
				return {
					build: function <T>() {
						return 'test';
					},
				};
			}
		}</div>; }