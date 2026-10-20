function App() { return <div>
				@try {
					<AsyncThing />
				} @pending {
					<>Loading</>
				} catch (error) {
					<>Failed</>
				}
			</div>; }