
			something(() => {
				function App() {
					return <>@{
						const items = ['a', '', 'c'];
						@for (const item of items) {
							if (!item) continue;
							<li>{item}</li>
						}
					}</>;
				}
			});