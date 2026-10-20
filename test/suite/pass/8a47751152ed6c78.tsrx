function App() { return <div>
			@try {
				<ComponentThatSuspends />
			} @pending {
				<>Loading</>
			} @catch (error, reset) {
				<>Failed</>
			}
		</div>; }